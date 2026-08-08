/**
 * SoundGuard — Real-Time Sound Recognition Hook  (Android / EAS Development Build)
 * ──────────────────────────────────────────────────────────────────────────────────
 * Inference engine  : ONNX Runtime Mobile  (onnxruntime-react-native)
 * Audio capture     : react-native-live-audio-stream  (true raw PCM via AudioRecord)
 * Feature pipeline  : LiveAudioStream → Int16 PCM → resample 16k→22.05k
 *                     → Silence Gate → Rolling buffer → Mel-spectrogram → ONNX
 *
 * SILENCE GATE RECALIBRATION (v2):
 *
 *   The previous Stage A threshold (0.012) was over-aggressive.  It was resetting
 *   the rolling buffer on EVERY silent chunk, which is fatal for sounds with quiet
 *   onsets: a dog bark's attack begins at RMS ~0.005–0.010 for the first 50–100 ms
 *   before the primary body arrives.  With the old gate, the buffer was wiped
 *   mid-event so the complete 3-second window was never assembled.
 *
 *   New strategy:
 *
 *   STAGE A — Chunk-level gate (per ~256 ms chunk, before buffer append):
 *     Threshold lowered to 0.004 — comfortably above digital silence
 *     (thermal + quantisation noise: RMS ≈ 0.001–0.003) while passing the quiet
 *     onset of dog barks, door knocks, and footsteps.
 *
 *     *** CRITICAL CHANGE: Stage A no longer RESETS the ring buffer. ***
 *     It simply skips accumulation for that chunk.  The buffer retains any samples
 *     already written.  This lets the next loud chunk continue filling from where
 *     it left off.  Buffer is only reset when a window is dispatched or listening stops.
 *
 *   STAGE B — Window-level gate (full 3 s window, before spectrogram + ONNX):
 *     Base threshold 0.005.  Modulated by the user's sensitivity setting (1–5).
 *     Sensitivity 1 = ×2.0 (conservative), Sensitivity 5 = ×0.3 (aggressive).
 *
 *   CONFIDENCE THRESHOLD:
 *     Lowered from 0.65 → 0.52.  Freshly-trained models peak at 0.55–0.75 for
 *     correct predictions; confused outputs sit near 0.143 (1/7 classes).
 *
 * HISTORY LOGGING:
 *   Every warning/critical detection is persisted via saveDetectionEvent().
 *   Safe-class events are intentionally not logged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import { Buffer } from 'buffer';
import {
  extractMelSpectrogram,
  SAMPLE_RATE,
  CLIP_DURATION,
  CLIP_SAMPLES,
} from '@/utils/audio/melSpectrogram';
import { getSettings, saveDetectionEvent } from '@/utils/storage';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ThreatLevel = 'safe' | 'warning' | 'critical';

export type SoundPrediction = {
  label: string;
  confidence: number;
  threatLevel: ThreatLevel;
  timestamp: number;
};

export type RecognitionState = {
  isListening: boolean;
  isModelLoaded: boolean;
  hasPermission: boolean;
  prediction: SoundPrediction | null;
  criticalStreakSeconds: number;
  error: string | null;
};

// ─────────────────────────────────────────────────────────────────
// Label / Threat configuration
// ─────────────────────────────────────────────────────────────────

const LABELS = [
  'car_horn',
  'crying_baby',
  'dog',
  'door_wood_knock',
  'footsteps',
  'glass_breaking',
  'siren',
] as const;

type SoundLabel = typeof LABELS[number];

const DISPLAY_NAMES: Record<SoundLabel, string> = {
  car_horn:        'Car Horn',
  crying_baby:     'Crying Baby',
  dog:             'Dog Bark',
  door_wood_knock: 'Door Knock',
  footsteps:       'Footsteps',
  glass_breaking:  'Glass Breaking',
  siren:           'Siren',
};

const THREAT_MAP: Record<SoundLabel, ThreatLevel> = {
  car_horn:        'warning',
  crying_baby:     'warning',
  dog:             'safe',
  door_wood_knock: 'safe',
  footsteps:       'safe',
  glass_breaking:  'critical',
  siren:           'critical',
};

// ─────────────────────────────────────────────────────────────────
// Audio capture constants
// ─────────────────────────────────────────────────────────────────

/** 16 000 Hz: universal Android hardware guarantee. */
const CAPTURE_RATE = 16000;

/**
 * MediaRecorder.AudioSource.VOICE_RECOGNITION — disables system AGC,
 * echo cancellation, and noise suppression.  Raw acoustic signal needed
 * for the environmental sound CNN.
 */
const AUDIO_SOURCE = 6;

/** 4096 samples ≈ 256 ms at 16 kHz. */
const BUFFER_SIZE_SAMPLES = 4096;

// ─────────────────────────────────────────────────────────────────
// ONNX constants
// ─────────────────────────────────────────────────────────────────

const ONNX_INPUT_NAME  = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';

/** [batch=1, mel_bands=128, time_frames=128, channels=1] */
const ONNX_INPUT_DIMS: readonly number[] = [1, 128, 128, 1];

// ─────────────────────────────────────────────────────────────────
// Silence Gate thresholds  (recalibrated v2)
// ─────────────────────────────────────────────────────────────────

/**
 * SILENCE_CHUNK_RMS_THRESHOLD — Stage A gate.
 *
 * Lowered to 0.004 to capture quiet sound onsets.
 * Digital noise floor (VOICE_RECOGNITION source): RMS ≈ 0.001–0.003.
 *
 * IMPORTANT: Stage A now only SKIPS accumulation — it does NOT reset
 * the ring buffer.  This preserves data from quiet-onset transients
 * already accumulated in the buffer.
 */
const SILENCE_CHUNK_RMS_THRESHOLD = 0.004;

/**
 * SILENCE_WINDOW_RMS_THRESHOLD_BASE — Stage B base gate.
 *
 * Applied to the full 3-second window before spectrogram + inference.
 * Effective threshold = base × SENSITIVITY_MULTIPLIERS[sensitivity - 1].
 */
const SILENCE_WINDOW_RMS_THRESHOLD_BASE = 0.005;

/**
 * Per-sensitivity multipliers for Stage B.
 * Index 0 = sensitivity 1 (Conservative) … index 4 = sensitivity 5 (Aggressive).
 */
const SENSITIVITY_MULTIPLIERS = [2.0, 1.5, 1.0, 0.6, 0.3] as const;

/**
 * Confidence floor — lowered from 0.65 to 0.52 to accommodate freshly-trained
 * model output ranges while still suppressing uniform/confused outputs (~0.143).
 */
const CONFIDENCE_THRESHOLD = 0.52;

// ─────────────────────────────────────────────────────────────────
// Module-level ONNX session cache
// ─────────────────────────────────────────────────────────────────

let _onnxSession: InferenceSession | null = null;
let _onnxSessionLoading = false;
let _onnxSessionLoadAttempted = false;

// ─────────────────────────────────────────────────────────────────
// DSP utilities
// ─────────────────────────────────────────────────────────────────

/**
 * computeRMS — Root Mean Square energy of a Float32 PCM buffer.
 *   RMS = √( (1/N) · Σᵢ xᵢ² )
 * O(n) complexity, synchronous.
 */
function computeRMS(samples: Float32Array): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sumOfSquares = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] ?? 0;
    sumOfSquares += s * s;
  }
  return Math.sqrt(sumOfSquares / n);
}

/**
 * resampleLinear — linear-interpolation resampler.
 * O(n_out) — safe to run synchronously per chunk.
 */
function resampleLinear(
  samples: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate) return samples;
  const ratio   = dstRate / srcRate;
  const outLen  = Math.floor(samples.length * ratio);
  const out     = new Float32Array(outLen);
  const lastIdx = samples.length - 1;
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const lo     = Math.floor(srcPos);
    const hi     = lo < lastIdx ? lo + 1 : lastIdx;
    const frac   = srcPos - lo;
    out[i] = (samples[lo] ?? 0) * (1 - frac) + (samples[hi] ?? 0) * frac;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// ONNX Model Loader
// ─────────────────────────────────────────────────────────────────

/**
 * loadOnnxModel
 *
 * Copies sound_model.onnx from the Metro asset bundle to documentDirectory
 * (guaranteed POSIX-writable), then opens an InferenceSession.
 *
 * MODEL FRESHNESS CHECK: compares byte sizes (O(1) stat call).
 * If sizes differ, the APK contains a newer model — force-copy it.
 *
 * Idempotent within a single JS session.
 */
async function loadOnnxModel(): Promise<InferenceSession | null> {
  if (_onnxSession)            return _onnxSession;
  if (_onnxSessionLoading) {
    await new Promise<void>((r) => setTimeout(r, 250));
    return _onnxSession;
  }
  if (_onnxSessionLoadAttempted) return null;

  _onnxSessionLoading       = true;
  _onnxSessionLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modelModule = require('../assets/model/sound_model.onnx');
    const asset       = Asset.fromModule(modelModule);

    if (!asset.localUri) await asset.downloadAsync();
    if (!asset.localUri) throw new Error('expo-asset: localUri null after downloadAsync()');

    const destUri = `${FileSystem.documentDirectory}sound_model.onnx`;

    const [cachedInfo, bundledInfo] = await Promise.all([
      FileSystem.getInfoAsync(destUri,        { size: true }),
      FileSystem.getInfoAsync(asset.localUri, { size: true }),
    ]);

    const cachedSize  = cachedInfo.exists  ? (cachedInfo  as any).size ?? -1 : -1;
    const bundledSize = bundledInfo.exists ? (bundledInfo as any).size ?? -2 : -2;
    const needsCopy   = !cachedInfo.exists || cachedSize !== bundledSize;

    if (needsCopy) {
      await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
      console.log(`[ONNX] Model ${cachedInfo.exists ? 'updated' : 'installed'} → ${bundledSize} bytes`);
    } else {
      console.log('[ONNX] Cached model is current — skipping copy', `(${cachedSize} bytes)`);
    }

    const nativePath = destUri.replace(/^file:\/\//, '');

    _onnxSession = await InferenceSession.create(nativePath, {
      executionProviders: ['cpu'],
    });

    console.log('[ONNX] Session ready →', nativePath);
    return _onnxSession;
  } catch (err) {
    console.warn('[ONNX] Model load failed:', err);
    _onnxSessionLoadAttempted = false;
    return null;
  } finally {
    _onnxSessionLoading = false;
  }
}

// ─────────────────────────────────────────────────────────────────
// ONNX Inference
// ─────────────────────────────────────────────────────────────────

async function runOnnxInference(
  session: InferenceSession,
  melFeatures: Float32Array,
): Promise<{ label: SoundLabel; confidence: number } | null> {
  try {
    const inputTensor = new Tensor('float32', melFeatures, ONNX_INPUT_DIMS as number[]);
    const results     = await session.run({ [ONNX_INPUT_NAME]: inputTensor });

    let outputTensor = results[ONNX_OUTPUT_NAME];
    if (!outputTensor) {
      const firstKey = Object.keys(results)[0];
      if (!firstKey) {
        console.warn('[ONNX] session.run() returned no output tensors');
        return null;
      }
      console.warn(`[ONNX] Output key "${ONNX_OUTPUT_NAME}" not found — using "${firstKey}".`);
      outputTensor = results[firstKey]!;
    }

    const probs = outputTensor.data as Float32Array;
    if (!probs?.length) return null;

    let maxIdx = 0;
    let maxVal = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i++) {
      const v = probs[i] ?? 0;
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }

    const topLabel = LABELS[maxIdx] ?? 'footsteps';

    LABELS.forEach((lbl, i) => {
      const p    = (probs[i] ?? 0).toFixed(4);
      const mark = i === maxIdx ? '  ◀ TOP' : '';
      console.log(`[ONNX Live] class=${lbl.padEnd(16)} prob=${p}${mark}`);
    });

    return { label: topLabel as SoundLabel, confidence: maxVal };
  } catch (err) {
    console.warn('[ONNX] Inference error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Android permission helper
// ─────────────────────────────────────────────────────────────────

async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title:          'Microphone Permission',
        message:        'SoundGuard needs microphone access to detect environmental sounds.',
        buttonPositive: 'Allow',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────

export function useSoundRecognition() {
  const [state, setState] = useState<RecognitionState>({
    isListening:          false,
    isModelLoaded:        false,
    hasPermission:        false,
    prediction:           null,
    criticalStreakSeconds: 0,
    error:                null,
  });

  // ── Refs ─────────────────────────────────────────────────────────

  /**
   * Pre-allocated ring buffer holding resampled PCM at 22 050 Hz.
   * writePtr tracks the next write position.
   */
  const ringBufferRef = useRef<Float32Array>(new Float32Array(CLIP_SAMPLES));
  const writePtrRef   = useRef<number>(0);

  const isListeningRef     = useRef(false);

  /**
   * inferenceActiveRef — strict boolean mutex.
   * Released unconditionally in the finally block of runInferencePipeline.
   */
  const inferenceActiveRef = useRef(false);

  const criticalStreakRef  = useRef(0);
  const onnxSessionRef     = useRef<InferenceSession | null>(null);

  /**
   * sensitivityRef — current sensitivity level (1–5) read from Settings.
   * Updated on every startListening() call so slider changes take effect
   * on the next session without requiring a hook remount.
   */
  const sensitivityRef = useRef(3);

  const consecutiveSilentWindowsRef = useRef(0);

  // ── Eagerly load the ONNX model on mount ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadOnnxModel();
      if (cancelled) return;
      if (session) {
        onnxSessionRef.current = session;
        setState((s) => ({ ...s, isModelLoaded: true }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Core inference pipeline ───────────────────────────────────────
  const runInferencePipeline = useCallback(async (
    window: Float32Array,
  ): Promise<void> => {
    if (!onnxSessionRef.current) {
      console.log('[Pipeline] ONNX session not ready — skipping window');
      return;
    }

    if (inferenceActiveRef.current) {
      console.log('[Pipeline] Previous inference still running — dropping window');
      return;
    }

    // ── Stage B: Window-level RMS silence gate ────────────────────
    const multiplierIdx = Math.max(0, Math.min(4, sensitivityRef.current - 1));
    const multiplier    = SENSITIVITY_MULTIPLIERS[multiplierIdx] ?? 1.0;
    const effectiveWindowThreshold = SILENCE_WINDOW_RMS_THRESHOLD_BASE * multiplier;

    const windowRMS = computeRMS(window);
    if (windowRMS < effectiveWindowThreshold) {
      consecutiveSilentWindowsRef.current += 1;
      console.log(
        `[SilenceGate B] Window dropped — RMS=${windowRMS.toFixed(5)} < ` +
        `threshold=${effectiveWindowThreshold.toFixed(5)} ` +
        `(sensitivity=${sensitivityRef.current}, consecutive=${consecutiveSilentWindowsRef.current})`,
      );
      criticalStreakRef.current = 0;
      setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
      return;
    }

    consecutiveSilentWindowsRef.current = 0;
    inferenceActiveRef.current = true;

    try {
      const melFeatures = extractMelSpectrogram(window);
      const result      = await runOnnxInference(onnxSessionRef.current, melFeatures);

      if (!result) {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      const { label, confidence } = result;

      if (confidence < CONFIDENCE_THRESHOLD) {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      const threatLevel = THREAT_MAP[label];

      // Safe classes: reset streak, clear prediction, do NOT log to history.
      if (threatLevel === 'safe') {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      // Warning / Critical: update streak and persist to history log.
      if (threatLevel === 'critical') {
        criticalStreakRef.current += CLIP_DURATION;
      } else {
        criticalStreakRef.current = 0;
      }

      const prediction: SoundPrediction = {
        label:      DISPLAY_NAMES[label],
        confidence,
        threatLevel,
        timestamp:  Date.now(),
      };

      // Persist to history (fire-and-forget, non-blocking, non-fatal).
      saveDetectionEvent({
        id:         `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        soundName:  DISPLAY_NAMES[label],
        rawLabel:   label,
        confidence,
        threatLevel,
        timestamp:  Date.now(),
      }).catch(() => {/* storage errors are non-fatal */});

      setState((s) => ({
        ...s,
        prediction,
        criticalStreakSeconds: criticalStreakRef.current,
      }));
    } catch (err) {
      console.warn('[Pipeline] Unhandled error in inference:', err);
      criticalStreakRef.current = 0;
      setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
    } finally {
      // UNCONDITIONAL release — every code path exits through here.
      inferenceActiveRef.current = false;
    }
  }, []);

  // ── Request microphone permission ────────────────────────────────
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await requestMicrophonePermission();
    setState((s) => ({ ...s, hasPermission: granted }));
    return granted;
  }, []);

  // ── Start live listening ─────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    // Read current sensitivity from persisted settings before starting.
    try {
      const settings = await getSettings();
      sensitivityRef.current = settings.sensitivity ?? 3;
    } catch {
      sensitivityRef.current = 3;
    }

    const granted = await requestPermission();
    if (!granted) {
      setState((s) => ({ ...s, error: 'Microphone permission denied' }));
      return;
    }

    if (!onnxSessionRef.current) {
      loadOnnxModel().then((session) => {
        if (session) {
          onnxSessionRef.current = session;
          setState((s) => ({ ...s, isModelLoaded: true }));
        } else {
          setState((s) => ({
            ...s,
            error: 'ONNX model failed to load. Ensure sound_model.onnx is in assets/model/.',
          }));
        }
      });
    }

    // ── Reset all mutable state for the new session ───────────────
    isListeningRef.current              = true;
    inferenceActiveRef.current          = false;
    criticalStreakRef.current           = 0;
    consecutiveSilentWindowsRef.current = 0;
    writePtrRef.current                 = 0;
    // Zero-fill to prevent stale data from a previous session leaking into
    // the first window.
    ringBufferRef.current.fill(0);

    setState((s) => ({
      ...s,
      isListening:          true,
      isModelLoaded:        !!onnxSessionRef.current,
      error:                null,
      prediction:           null,
      criticalStreakSeconds: 0,
    }));

    LiveAudioStream.init({
      sampleRate:    CAPTURE_RATE,       // 16 000 Hz
      channels:      1,                  // mono
      bitsPerSample: 16,                 // signed int16 LE
      audioSource:   AUDIO_SOURCE,       // 6 = VOICE_RECOGNITION (raw, no AGC)
      bufferSize:    BUFFER_SIZE_SAMPLES,
    });

    // ── 'data' event handler (synchronous body) ───────────────────
    //
    // Kept synchronous so buffer writes are serialised by the JS event loop.
    // Only the async inference is fire-and-forgotten.
    LiveAudioStream.on('data', (base64Chunk: string) => {
      if (!isListeningRef.current) return;

      try {
        // Step 1: Decode base64 → Int16 → Float32 normalised PCM
        const rawBytes   = Buffer.from(base64Chunk, 'base64');
        const numSamples = Math.floor(rawBytes.length / 2);
        if (numSamples === 0) return;

        const int16View    = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, numSamples);
        const float32Chunk = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          float32Chunk[i] = (int16View[i] ?? 0) / 32768;
        }

        // Step 2: Resample 16 kHz → 22.05 kHz
        const resampled = resampleLinear(float32Chunk, CAPTURE_RATE, SAMPLE_RATE);

        // Step 3: Stage A — Chunk-level RMS gate
        // *** Only SKIP accumulation — do NOT reset the buffer. ***
        // Retaining partial buffer data allows quiet-onset transients (dog barks,
        // door knocks) to be completed by the next loud chunk.
        const chunkRMS = computeRMS(resampled);
        if (chunkRMS < SILENCE_CHUNK_RMS_THRESHOLD) {
          criticalStreakRef.current = 0;
          return; // ← no buffer reset here (key change from v1)
        }

        // Step 4: Append resampled chunk to ring buffer
        const ring     = ringBufferRef.current;
        const chunkLen = resampled.length;
        let   ptr      = writePtrRef.current;
        const capacity = CLIP_SAMPLES;

        const spaceLeft = capacity - ptr;
        const toCopy    = Math.min(chunkLen, spaceLeft);

        for (let i = 0; i < toCopy; i++) {
          ring[ptr + i] = resampled[i] ?? 0;
        }
        ptr += toCopy;
        writePtrRef.current = ptr;

        // Step 5: Full window ready — dispatch to inference pipeline
        if (ptr >= capacity) {
          const windowSnapshot = ring.slice(0, capacity) as Float32Array;
          writePtrRef.current  = 0;  // reset pointer immediately (not the data)

          console.log(
            `[Audio] Window ready: ${capacity} samples @ ${SAMPLE_RATE} Hz`,
            `(captured @ ${CAPTURE_RATE} Hz, resampled)`,
          );

          runInferencePipeline(windowSnapshot);

          // Seed next window with any leftover samples from this chunk
          // so we don't lose audio continuity at window boundaries.
          if (chunkLen > toCopy) {
            const remaining = chunkLen - toCopy;
            for (let i = 0; i < remaining && i < capacity; i++) {
              ring[i] = resampled[toCopy + i] ?? 0;
            }
            writePtrRef.current = Math.min(remaining, capacity);
          }
        }
      } catch (err) {
        console.warn('[Audio] Chunk processing error:', err);
      }
    });

    LiveAudioStream.start();
    console.log('[Audio] LiveAudioStream started at', CAPTURE_RATE, 'Hz');
    console.log('[SilenceGate] Chunk RMS threshold (skip-only, no reset):', SILENCE_CHUNK_RMS_THRESHOLD);
    console.log('[SilenceGate] Window RMS base threshold:', SILENCE_WINDOW_RMS_THRESHOLD_BASE);
    console.log('[SilenceGate] Sensitivity level:', sensitivityRef.current);
  }, [requestPermission, runInferencePipeline]);

  // ── Stop listening ────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;

    isListeningRef.current              = false;
    criticalStreakRef.current           = 0;
    consecutiveSilentWindowsRef.current = 0;

    try { LiveAudioStream.stop(); } catch {}

    writePtrRef.current        = 0;
    inferenceActiveRef.current = false;

    console.log('[Audio] LiveAudioStream stopped');

    setState((s) => ({
      ...s,
      isListening:          false,
      prediction:           null,
      criticalStreakSeconds: 0,
    }));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (isListeningRef.current) {
        isListeningRef.current     = false;
        inferenceActiveRef.current = false;
        writePtrRef.current        = 0;
        try { LiveAudioStream.stop(); } catch {}
      }
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
  };
}
