/**
 * SoundGuard — Real-Time Sound Recognition Hook  (Android / EAS Development Build)
 * ──────────────────────────────────────────────────────────────────────────────────
 * Inference engine  : ONNX Runtime Mobile  (onnxruntime-react-native)
 * Audio capture     : react-native-live-audio-stream  (true raw PCM via AudioRecord)
 * Feature pipeline  : LiveAudioStream → Int16 PCM → resample 16k→22.05k
 *                     → Silence Gate → Rolling buffer → Mel-spectrogram → ONNX
 *
 * SILENCE GATE (the key addition in this version):
 *   Android's AudioRecord at audioSource=6 (VOICE_RECOGNITION) captures the raw
 *   microphone ADC output with no AGC or noise suppression.  In a quiet room the
 *   microphone still produces low-level quantisation noise / thermal noise, which
 *   when normalised and fed to the Mel-spectrogram pipeline produces a spectrogram
 *   that strongly resembles broadband transient sounds, causing the ONNX model to
 *   output near-1.0 confidence for classes like 'glass_breaking' or 'car_horn'.
 *
 *   The gate operates in two complementary stages:
 *
 *   STAGE A — Chunk-level RMS gate  (runs on every incoming PCM chunk):
 *     After resampling, the RMS energy of the float32 chunk is computed.
 *     If RMS < SILENCE_CHUNK_RMS_THRESHOLD the chunk is discarded and NOT
 *     appended to the rolling buffer.  This prevents the buffer from filling
 *     with silence data, naturally pausing the pipeline until real sound arrives.
 *     The buffer is also cleared so the next real-sound chunk starts a fresh window
 *     rather than being mixed with stale near-silence data.
 *
 *   STAGE B — Window-level RMS gate  (runs just before spectrogram/inference):
 *     Even if individual chunks pass Stage A, the full 3-second window is re-checked
 *     before the expensive Mel-spectrogram and ONNX inference are invoked.
 *     If the window RMS < SILENCE_WINDOW_RMS_THRESHOLD inference is skipped,
 *     criticalStreak is reset, and the UI is reset to "safe/monitoring" state.
 *
 *   RMS is the correct DSP primitive for this task: it measures the average power
 *   of the signal (RMS = √(Σxᵢ²/N)), which is proportional to perceptual loudness
 *   and maps directly to the energy scale the Mel-spectrogram normalises.
 *   O(n) complexity — safe to run synchronously on the JS event loop per chunk.
 *
 * RING BUFFER:
 *   The previous implementation accumulated samples into a plain number[] with
 *   repeated push() calls inside a loop, which is O(n²) for large n due to repeated
 *   array resizing.  This version uses a pre-allocated Float32Array ring buffer with
 *   a single write-pointer, giving O(1) amortised append and zero GC pressure.
 *
 * MUTEX CORRECTNESS:
 *   inferenceActiveRef gates re-entrant inference calls.  It is set to true
 *   exactly once before the async pipeline runs and unconditionally released in the
 *   finally block — covering every code path (success, inference error, null result,
 *   confidence below threshold, and safe class).  The chunk-level data handler is
 *   kept synchronous (no async/await) so it cannot race with itself.
 *
 * SAMPLE RATE STRATEGY:
 *   LiveAudioStream captures at 16 000 Hz (universal Android hardware guarantee).
 *   A pure-JS linear-interpolation resampler converts each PCM chunk from 16 000 Hz
 *   → 22 050 Hz so the Mel-spectrogram pipeline receives correctly-pitched features.
 *
 * LABELS (from assets/model/labels.txt):
 *   0: car_horn       → WARNING
 *   1: crying_baby    → WARNING
 *   2: dog            → safe
 *   3: door_wood_knock→ safe
 *   4: footsteps      → safe
 *   5: glass_breaking → CRITICAL
 *   6: siren          → CRITICAL
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

/**
 * 16 000 Hz: the guaranteed-working capture rate on all Android OEMs.
 * 22 050 Hz may throw AudioRecord init errors on certain MediaTek SoCs.
 */
const CAPTURE_RATE = 16000;

/**
 * MediaRecorder.AudioSource.VOICE_RECOGNITION — disables Android system-level
 * AGC, echo cancellation, and noise suppression.  We need the raw acoustic
 * signal for the environmental sound CNN; pre-processed audio distorts the
 * spectral features the model was trained on.
 */
const AUDIO_SOURCE = 6;

/**
 * 4096 samples ≈ 256 ms at 16 kHz.  Chosen for efficient JNI bridge throughput;
 * large enough to amortise the base64 decode overhead, small enough that the
 * rolling buffer fills in roughly 3 real-time seconds.
 */
const BUFFER_SIZE_SAMPLES = 4096;

/** Ratio used by the linear-interpolation resampler: 22050 / 16000 = 1.378125 */
const RESAMPLE_RATIO = SAMPLE_RATE / CAPTURE_RATE;

// ─────────────────────────────────────────────────────────────────
// ONNX constants
// ─────────────────────────────────────────────────────────────────

/** Node names validated via Netron on sound_model.onnx (tf2onnx SavedModel export). */
const ONNX_INPUT_NAME  = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';

/** [batch=1, mel_bands=128, time_frames=128, channels=1] */
const ONNX_INPUT_DIMS: readonly number[] = [1, 128, 128, 1];

// ─────────────────────────────────────────────────────────────────
// Silence Gate thresholds
// ─────────────────────────────────────────────────────────────────

/**
 * SILENCE_CHUNK_RMS_THRESHOLD  — Stage A gate (per-chunk, before buffer append).
 *
 * Android microphone noise floor (VOICE_RECOGNITION source, quiet room):
 *   RMS ≈ 0.002 – 0.007  (quantisation noise + thermal noise)
 *
 * Lightest real-world sound events:
 *   footsteps at 2 m: RMS ≈ 0.020 – 0.040
 *   distant speech:   RMS ≈ 0.015 – 0.030
 *
 * Threshold at 0.012 leaves an ~80 % margin above the noise floor and catches
 * all real sound events comfortably.  Increase toward 0.025 in noisier
 * deployment environments if needed.
 */
const SILENCE_CHUNK_RMS_THRESHOLD = 0.012;

/**
 * SILENCE_WINDOW_RMS_THRESHOLD  — Stage B gate (full 3-second window, before inference).
 *
 * Set slightly lower than Stage A to catch windows where a few loud chunks
 * slipped through Stage A but the overall window is still mostly silent.
 * This is the last defence before the expensive spectrogram + ONNX pipeline.
 */
const SILENCE_WINDOW_RMS_THRESHOLD = 0.008;

/** ONNX classification confidence floor — predictions below this are discarded. */
const CONFIDENCE_THRESHOLD = 0.65;

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
 * computeRMS
 *
 * Computes the Root Mean Square energy of a Float32 PCM buffer.
 *
 *   RMS = √( (1/N) · Σᵢ xᵢ² )
 *
 * This is the standard DSP measure for signal power / perceptual loudness.
 * For normalised [-1, +1] PCM:
 *   - Digital silence / noise floor: RMS ≈ 0.002 – 0.008
 *   - Quiet room ambient:            RMS ≈ 0.008 – 0.015
 *   - Speech / footsteps:            RMS ≈ 0.015 – 0.060
 *   - Horn / siren:                  RMS ≈ 0.060 – 0.300
 *   - Glass breaking (impact):       RMS ≈ 0.100 – 0.500 (short burst)
 *
 * Complexity: O(n) — runs synchronously on the JS thread without blocking.
 *
 * @param samples Float32Array of PCM samples in [-1, +1]
 * @returns RMS energy in [0, 1]
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
 * resampleLinear
 *
 * Resamples a Float32Array from srcRate to dstRate using linear interpolation.
 * Equivalent to SciPy's resample_poly for the frequency bands relevant to
 * environmental sound classification (< 8 kHz).
 *
 * Complexity: O(n_out) — safe to run synchronously per chunk.
 */
function resampleLinear(
  samples: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate) return samples;

  const ratio    = dstRate / srcRate;
  const outLen   = Math.floor(samples.length * ratio);
  const out      = new Float32Array(outLen);
  const lastIdx  = samples.length - 1;

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
 * (a guaranteed POSIX-writable path), then opens an InferenceSession.
 *
 * The ONNX C++ backend cannot read Metro asset-server URLs; it requires a
 * plain file-system path — hence the copy step.
 *
 * Idempotent: returns the cached session on all subsequent calls.
 */
async function loadOnnxModel(): Promise<InferenceSession | null> {
  if (_onnxSession)            return _onnxSession;
  if (_onnxSessionLoading) {
    // Another concurrent call is mid-load — poll briefly then return.
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

    const destUri  = `${FileSystem.documentDirectory}sound_model.onnx`;
    const destInfo = await FileSystem.getInfoAsync(destUri);
    if (!destInfo.exists) {
      await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
      console.log('[ONNX] Model copied to documentDirectory');
    } else {
      console.log('[ONNX] Model already present — skipping copy');
    }

    // ONNX C++ backend requires a plain POSIX path, not a file:// URI.
    const nativePath = destUri.replace(/^file:\/\//, '');

    _onnxSession = await InferenceSession.create(nativePath, {
      executionProviders: ['cpu'],
    });

    console.log('[ONNX] Session ready →', nativePath);
    return _onnxSession;
  } catch (err) {
    console.warn('[ONNX] Model load failed:', err);
    _onnxSessionLoadAttempted = false; // allow a retry on next startListening()
    return null;
  } finally {
    _onnxSessionLoading = false;
  }
}

// ─────────────────────────────────────────────────────────────────
// ONNX Inference
// ─────────────────────────────────────────────────────────────────

/**
 * runOnnxInference
 *
 * Executes a single forward pass through the ONNX model.
 *
 * Input tensor:  Float32Array [128 × 128] flat row-major Mel-spectrogram,
 *                reshaped to [1, 128, 128, 1] via ONNX_INPUT_DIMS.
 * Output tensor: Float32Array [7] — softmax class probabilities.
 *
 * Metro log format per inference:
 *   [ONNX Live] class=siren            prob=0.9200  ◀ TOP
 *   [ONNX Live] class=glass_breaking   prob=0.0412
 *   ...
 *
 * Falls back to the first available output key if ONNX_OUTPUT_NAME is not
 * found in the results map — prevents silent failures after model re-exports.
 */
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
      console.warn(
        `[ONNX] Output key "${ONNX_OUTPUT_NAME}" not found — using "${firstKey}". Verify with Netron.`,
      );
      outputTensor = results[firstKey]!;
    }

    const probs = outputTensor.data as Float32Array;
    if (!probs?.length) return null;

    // Argmax
    let maxIdx = 0;
    let maxVal = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i++) {
      const v = probs[i] ?? 0;
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }

    const topLabel = LABELS[maxIdx] ?? 'footsteps';

    // Live Metro probability log — all classes, winner highlighted
    LABELS.forEach((lbl, i) => {
      const p     = (probs[i] ?? 0).toFixed(4);
      const mark  = i === maxIdx ? '  ◀ TOP' : '';
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
   *
   * Using a typed Float32Array of fixed capacity CLIP_SAMPLES eliminates
   * the O(n²) resizing cost of the previous number[]/push() approach and
   * produces zero GC pressure during the hot path.  writePtr tracks the
   * next write position; when it reaches CLIP_SAMPLES the window is ready.
   */
  const ringBufferRef = useRef<Float32Array>(new Float32Array(CLIP_SAMPLES));
  const writePtrRef   = useRef<number>(0);

  const isListeningRef     = useRef(false);

  /**
   * inferenceActiveRef — strict boolean mutex.
   *
   * Set to true immediately before the async inference pipeline begins.
   * Released unconditionally in the finally block — covers every exit path:
   *   · Successful prediction (warning / critical / safe)
   *   · Confidence below threshold
   *   · Null result from ONNX (model error)
   *   · Exception anywhere in the pipeline
   *   · Silence gate rejection at window level
   *
   * The chunk-level data handler is synchronous, so it never contends with
   * itself.  The only contention point is this flag guarding runOnnxInference.
   */
  const inferenceActiveRef = useRef(false);

  const criticalStreakRef  = useRef(0);
  const onnxSessionRef     = useRef<InferenceSession | null>(null);

  /**
   * consecutiveSilentWindowsRef — counts consecutive windows dropped by the
   * silence gate.  Used solely for Metro diagnostic logging.
   */
  const consecutiveSilentWindowsRef = useRef(0);

  // ── Helper: synchronous reset of rolling buffer ───────────────────
  // Called both when a silent chunk is detected (Stage A) and when inference
  // begins (to start a fresh window for the next 3 seconds).
  const resetRingBuffer = useCallback(() => {
    // Overwriting writePtr to 0 is sufficient — the old data will be overwritten
    // by incoming chunks.  No need to zero-fill; CLIP_SAMPLES is always written
    // completely before inference fires.
    writePtrRef.current = 0;
  }, []);

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
  /**
   * runInferencePipeline
   *
   * Called with a full CLIP_SAMPLES window of resampled PCM.
   * Responsibilities (in order):
   *   1. Stage B silence gate (window-level RMS check)
   *   2. Acquire inferenceActiveRef mutex
   *   3. Mel-spectrogram extraction
   *   4. ONNX forward pass
   *   5. Threshold + threat classification
   *   6. State update
   *   7. Release inferenceActiveRef in finally (always)
   *
   * This function is fire-and-forget (not awaited by the caller).
   */
  const runInferencePipeline = useCallback(async (
    window: Float32Array,
  ): Promise<void> => {
    // ── Guard: session must be ready ────────────────────────────────
    // Do NOT hold the mutex here — if the session isn't ready we just skip
    // and the next window will retry.  No deadlock risk.
    if (!onnxSessionRef.current) {
      console.log('[Pipeline] ONNX session not ready — skipping window');
      return;
    }

    // ── Guard: prevent re-entrant inference ─────────────────────────
    if (inferenceActiveRef.current) {
      console.log('[Pipeline] Inference in progress — dropping window (budget device detected)');
      return;
    }

    // ── Stage B: Window-level RMS silence gate ───────────────────────
    const windowRMS = computeRMS(window);
    if (windowRMS < SILENCE_WINDOW_RMS_THRESHOLD) {
      consecutiveSilentWindowsRef.current += 1;
      console.log(
        `[SilenceGate B] Window dropped — RMS=${windowRMS.toFixed(5)} < threshold=${SILENCE_WINDOW_RMS_THRESHOLD}` +
        ` (consecutive silent windows: ${consecutiveSilentWindowsRef.current})`,
      );
      // Reset UI to safe/monitoring state — the environment is silent.
      criticalStreakRef.current = 0;
      setState((s) => ({
        ...s,
        prediction:           null,
        criticalStreakSeconds: 0,
      }));
      return;
    }

    // Window has real signal — reset silence counter and acquire mutex.
    consecutiveSilentWindowsRef.current = 0;
    inferenceActiveRef.current = true;

    try {
      // ── Mel-spectrogram extraction ─────────────────────────────────
      const melFeatures = extractMelSpectrogram(window);

      // ── ONNX inference ─────────────────────────────────────────────
      const result = await runOnnxInference(onnxSessionRef.current, melFeatures);

      // ── Result: null (model error) ────────────────────────────────
      if (!result) {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      const { label, confidence } = result;

      // ── Result: below confidence threshold ────────────────────────
      if (confidence < CONFIDENCE_THRESHOLD) {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      const threatLevel = THREAT_MAP[label];

      // ── Result: safe class ────────────────────────────────────────
      if (threatLevel === 'safe') {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      // ── Result: warning or critical ───────────────────────────────
      if (threatLevel === 'critical') {
        criticalStreakRef.current += CLIP_DURATION;
      } else {
        // 'warning' — reset streak; warnings don't accumulate toward SOS.
        criticalStreakRef.current = 0;
      }

      setState((s) => ({
        ...s,
        prediction: {
          label:      DISPLAY_NAMES[label],
          confidence,
          threatLevel,
          timestamp:  Date.now(),
        },
        criticalStreakSeconds: criticalStreakRef.current,
      }));
    } catch (err) {
      console.warn('[Pipeline] Unhandled error in inference:', err);
      // Safe reset — don't leave stale predictions on screen.
      criticalStreakRef.current = 0;
      setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
    } finally {
      // UNCONDITIONAL release — this is the only place that sets this to false.
      // Every code path above (early returns via return, exceptions) falls through
      // here because finally always executes.
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

    const granted = await requestPermission();
    if (!granted) {
      setState((s) => ({ ...s, error: 'Microphone permission denied' }));
      return;
    }

    // Trigger model load if the mount effect hasn't resolved yet.
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
    isListeningRef.current                  = true;
    inferenceActiveRef.current              = false;
    criticalStreakRef.current               = 0;
    consecutiveSilentWindowsRef.current     = 0;
    writePtrRef.current                     = 0;
    // Zero-fill the ring buffer so stale data from a previous session cannot
    // leak into the first window of the new session.
    ringBufferRef.current.fill(0);

    setState((s) => ({
      ...s,
      isListening:          true,
      isModelLoaded:        !!onnxSessionRef.current,
      error:                null,
      prediction:           null,
      criticalStreakSeconds: 0,
    }));

    // ── Configure LiveAudioStream ─────────────────────────────────
    LiveAudioStream.init({
      sampleRate:    CAPTURE_RATE,       // 16 000 Hz
      channels:      1,                  // mono
      bitsPerSample: 16,                 // signed int16 LE
      audioSource:   AUDIO_SOURCE,       // 6 = VOICE_RECOGNITION (raw, no AGC)
      bufferSize:    BUFFER_SIZE_SAMPLES,
    });

    // ── 'data' event handler ─────────────────────────────────────
    //
    // Design rationale for keeping this handler SYNCHRONOUS:
    //   The 'data' event is emitted by DeviceEventEmitter on the JS thread.
    //   If the handler is async, multiple invocations can be scheduled and
    //   interleave in the microtask queue, causing concurrent writes to the
    //   ring buffer.  By keeping all buffer manipulation synchronous and only
    //   fire-and-forgetting the async inference call, we guarantee that buffer
    //   writes are serialised by the JS event loop.
    //
    // Steps per chunk:
    //   1. Guard: stop processing immediately if listening has been cancelled.
    //   2. Decode base64 → Int16 → Float32 normalised PCM.
    //   3. Resample from 16 000 Hz → 22 050 Hz.
    //   4. Stage A silence gate: compute chunk RMS; drop + reset buffer if silent.
    //   5. Append chunk to ring buffer.
    //   6. When ring buffer is full, slice window and fire inference.
    LiveAudioStream.on('data', (base64Chunk: string) => {
      // ── Guard ──────────────────────────────────────────────────
      if (!isListeningRef.current) return;

      try {
        // ── Step 2: Decode ────────────────────────────────────────
        const rawBytes   = Buffer.from(base64Chunk, 'base64');
        const numSamples = Math.floor(rawBytes.length / 2);
        if (numSamples === 0) return;

        // Int16Array view over the raw byte buffer — zero-copy
        const int16View    = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, numSamples);
        const float32Chunk = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          float32Chunk[i] = (int16View[i] ?? 0) / 32768;
        }

        // ── Step 3: Resample 16 kHz → 22.05 kHz ──────────────────
        const resampled = resampleLinear(float32Chunk, CAPTURE_RATE, SAMPLE_RATE);

        // ── Step 4: Stage A — Chunk-level RMS silence gate ────────
        const chunkRMS = computeRMS(resampled);
        if (chunkRMS < SILENCE_CHUNK_RMS_THRESHOLD) {
          // This chunk is below the noise floor — discard it and reset the
          // ring buffer so we don't mix silent chunks with future real audio.
          if (writePtrRef.current > 0) {
            // Only log + reset if the buffer had accumulated some data;
            // avoids flooding Metro during extended silence.
            console.log(
              `[SilenceGate A] Chunk dropped — RMS=${chunkRMS.toFixed(5)} < threshold=${SILENCE_CHUNK_RMS_THRESHOLD}. Buffer reset.`,
            );
            writePtrRef.current = 0;
          }
          // Also ensure the UI shows "monitoring" after a brief silence
          // by resetting the critical streak (but NOT the prediction yet —
          // Stage B / inference completion handles that to avoid UI flicker
          // during momentary gaps in a real sound event).
          criticalStreakRef.current = 0;
          return;
        }

        // ── Step 5: Append resampled chunk to ring buffer ─────────
        const ring      = ringBufferRef.current;
        const chunkLen  = resampled.length;
        let   ptr       = writePtrRef.current;
        const capacity  = CLIP_SAMPLES;

        // Copy as many samples as fit before the buffer is full.
        // If the chunk would overflow, we take only what fits and let Step 6
        // handle the full window immediately; the remaining samples will be
        // the start of the next window after the pointer resets.
        const spaceLeft = capacity - ptr;
        const toCopy    = Math.min(chunkLen, spaceLeft);

        for (let i = 0; i < toCopy; i++) {
          ring[ptr + i] = resampled[i] ?? 0;
        }
        ptr += toCopy;
        writePtrRef.current = ptr;

        // ── Step 6: Full window ready — fire inference ────────────
        if (ptr >= capacity) {
          // Take a snapshot of exactly CLIP_SAMPLES frames.
          // slice() allocates a new Float32Array, which is passed to the
          // async pipeline.  The ring buffer pointer is reset immediately so
          // accumulation for the next window begins right away without waiting
          // for inference to complete.
          const windowSnapshot = ring.slice(0, capacity) as Float32Array;
          writePtrRef.current  = 0;

          console.log(
            `[Audio] Window ready: ${capacity} samples @ ${SAMPLE_RATE} Hz`,
            `(captured @ ${CAPTURE_RATE} Hz, resampled)`,
          );

          // Fire-and-forget — inferenceActiveRef guards re-entry.
          runInferencePipeline(windowSnapshot);

          // If the chunk had leftover samples beyond CLIP_SAMPLES, seed the
          // next window with them so we don't lose audio continuity.
          if (chunkLen > toCopy) {
            const remaining = chunkLen - toCopy;
            for (let i = 0; i < remaining && i < capacity; i++) {
              ring[i] = resampled[toCopy + i] ?? 0;
            }
            writePtrRef.current = Math.min(remaining, capacity);
          }
        }
      } catch (err) {
        // Catch-all — a decode or buffer error should never crash the listener.
        console.warn('[Audio] Chunk processing error:', err);
      }
    });

    LiveAudioStream.start();
    console.log('[Audio] LiveAudioStream started at', CAPTURE_RATE, 'Hz');
    console.log('[SilenceGate] Chunk RMS threshold:', SILENCE_CHUNK_RMS_THRESHOLD);
    console.log('[SilenceGate] Window RMS threshold:', SILENCE_WINDOW_RMS_THRESHOLD);
  }, [requestPermission, runInferencePipeline, resetRingBuffer]);

  // ── Stop listening ────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;

    isListeningRef.current = false;
    criticalStreakRef.current = 0;
    consecutiveSilentWindowsRef.current = 0;

    // Stop the native AudioRecord thread — this terminates data event emission.
    try { LiveAudioStream.stop(); } catch {}

    // Clear ring buffer and release inference mutex.
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
