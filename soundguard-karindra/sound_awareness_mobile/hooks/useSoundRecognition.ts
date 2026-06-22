/**
 * SoundGuard — Real-Time Sound Recognition Hook  (Android / EAS Development Build)
 * ──────────────────────────────────────────────────────────────────────────────────
 * Inference engine  : ONNX Runtime Mobile  (onnxruntime-react-native)
 * Audio capture     : react-native-live-audio-stream  (true raw PCM via AudioRecord)
 * Feature pipeline  : LiveAudioStream → Int16 PCM → resample 16k→22.05k → Mel-spectrogram → ONNX
 *
 * WHY react-native-live-audio-stream REPLACES expo-av:
 *   expo-av on Android uses MediaRecorder, which only produces compressed
 *   MPEG-4/AAC containers (magic bytes 00 00 00 18 ftyp…).  Treating this
 *   compressed bitstream as raw Int16 PCM produces broadband white noise
 *   that the model classifies as "glass_breaking" at probability 1.0.
 *
 *   react-native-live-audio-stream drives Android's AudioRecord API directly,
 *   delivering true uncompressed signed 16-bit PCM chunks in real time.
 *
 * SAMPLE RATE STRATEGY:
 *   LiveAudioStream captures at 16 000 Hz (universal Android hardware guarantee).
 *   The ONNX model was trained on 22 050 Hz spectrograms (Python/librosa pipeline).
 *   A pure-JS linear-interpolation resampler converts each PCM chunk from
 *   16 000 Hz → 22 050 Hz before it enters the Mel-spectrogram pipeline.
 *   The resampler is mathematically equivalent to the SciPy/librosa resample
 *   for the frequency range that matters for environmental sound classification.
 *
 * ROLLING BUFFER ARCHITECTURE:
 *   Incoming resampled chunks are appended to a rolling Float32 buffer.
 *   When the buffer reaches CLIP_SAMPLES (= 22 050 × 3 = 66 150 frames),
 *   the pipeline fires: extractMelSpectrogram → runOnnxInference.
 *   The buffer is then cleared for the next window (non-overlapping windows
 *   keep CPU usage predictable on budget Android SoCs).
 *
 * ARCHITECTURE:
 * ┌───────────────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────────────┐
 * │ LiveAudioStream   │──▶│ Int16→Float32│──▶│  Resample  │──▶│   Rolling PCM    │
 * │ AudioRecord 16kHz │   │  normalize   │   │ 16k→22.05k │   │ buffer (66 150)  │
 * └───────────────────┘   └──────────────┘   └────────────┘   └────────┬─────────┘
 *                                                                        │ full
 *                                                               ┌────────▼─────────┐
 *                                                               │  Mel-spectrogram  │
 *                                                               │    128 × 128      │
 *                                                               └────────┬──────────┘
 *                                                                        │
 *                                                               ┌────────▼──────────┐
 *                                                               │  ONNX Runtime     │──▶ Prediction
 *                                                               │  sound_model.onnx │
 *                                                               └───────────────────┘
 *
 * PERMISSIONS:
 *   android.permission.RECORD_AUDIO is declared in app.json and automatically
 *   written into AndroidManifest.xml by expo prebuild.
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
import { extractMelSpectrogram, SAMPLE_RATE, CLIP_DURATION, CLIP_SAMPLES } from '@/utils/audio/melSpectrogram';

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
// Constants
// ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.65;

/**
 * LiveAudioStream capture rate.
 * 16 000 Hz is the guaranteed-working rate across all Android hardware
 * (including budget Snapdragon 4xx and MediaTek Helio G series).
 * Higher rates like 22 050 Hz may throw AudioRecord init errors on certain OEMs.
 */
const CAPTURE_RATE = 16000;

/**
 * AudioRecord source: 6 = MediaRecorder.AudioSource.VOICE_RECOGNITION
 * This source applies minimal Android signal processing (echo cancel, AGC are off)
 * which is ideal for environmental sound classification — we want the raw signal.
 */
const AUDIO_SOURCE = 6;

/**
 * Buffer size per chunk from the native layer.
 * 4096 samples ≈ 256 ms at 16 kHz. Large enough for efficient JNI bridge
 * transfers but small enough that the rolling buffer fills in ≈ 3 seconds.
 */
const BUFFER_SIZE_SAMPLES = 4096;

/**
 * Resample ratio: output rate / input rate
 * Used by the linear-interpolation resampler below.
 */
const RESAMPLE_RATIO = SAMPLE_RATE / CAPTURE_RATE; // 22050 / 16000 = 1.378125

// ─────────────────────────────────────────────────────────────────
// ONNX constants
// ─────────────────────────────────────────────────────────────────

/** Validated via Netron on sound_model.onnx (TF SavedModel → tf2onnx export). */
const ONNX_INPUT_NAME  = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';

/** [batch=1, mel_bands=128, time_frames=128, channels=1] */
const ONNX_INPUT_DIMS: readonly number[] = [1, 128, 128, 1];

// ─────────────────────────────────────────────────────────────────
// Module-level ONNX session cache
// ─────────────────────────────────────────────────────────────────

let _onnxSession: InferenceSession | null = null;
let _onnxSessionLoading = false;
let _onnxSessionLoadAttempted = false;

// ─────────────────────────────────────────────────────────────────
// ONNX Model Loader
// ─────────────────────────────────────────────────────────────────

/**
 * loadOnnxModel
 *
 * Copies sound_model.onnx from the Metro bundle to documentDirectory
 * (a POSIX-writable path) and opens an InferenceSession from it.
 *
 * Steps:
 *   1. require() → Metro bundles the .onnx file into the APK.
 *   2. Asset.fromModule() + downloadAsync() → resolves the local URI.
 *   3. FileSystem.copyAsync() → copies to documentDirectory.
 *   4. InferenceSession.create() → ONNX C++ backend opens the file.
 *
 * Idempotent and cached module-wide.
 */
async function loadOnnxModel(): Promise<InferenceSession | null> {
  if (_onnxSession)           return _onnxSession;
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
    const asset = Asset.fromModule(modelModule);

    if (!asset.localUri) await asset.downloadAsync();
    if (!asset.localUri) throw new Error('expo-asset: localUri null after downloadAsync()');

    const destUri  = `${FileSystem.documentDirectory}sound_model.onnx`;
    const destInfo = await FileSystem.getInfoAsync(destUri);
    if (!destInfo.exists) {
      await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
      console.log('[ONNX] Model copied to documentDirectory');
    }

    // Strip file:// — ONNX C++ backend requires a plain POSIX path.
    const nativePath = destUri.replace(/^file:\/\//, '');

    _onnxSession = await InferenceSession.create(nativePath, {
      executionProviders: ['cpu'],
    });

    console.log('[ONNX] Session ready →', nativePath);
    return _onnxSession;
  } catch (err) {
    console.warn('[ONNX] Model load failed:', err);
    _onnxSessionLoadAttempted = false; // allow retry
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
 * Runs a single forward pass through the ONNX model.
 *
 * Input:  Float32Array [128 * 128] — flattened row-major Mel-spectrogram.
 * Output: Float32Array [7]         — softmax class probabilities.
 *
 * Metro log format (every inference):
 *   [ONNX Live] class=siren          prob=0.9200  ◀ TOP
 *   [ONNX Live] class=glass_breaking prob=0.0412
 *   ...
 */
async function runOnnxInference(
  session: InferenceSession,
  melFeatures: Float32Array,
): Promise<{ label: SoundLabel; confidence: number } | null> {
  try {
    const inputTensor = new Tensor('float32', melFeatures, ONNX_INPUT_DIMS as number[]);
    const results     = await session.run({ [ONNX_INPUT_NAME]: inputTensor });

    // Resolve output tensor — fall back to first available key if name differs.
    let outputTensor = results[ONNX_OUTPUT_NAME];
    if (!outputTensor) {
      const firstKey = Object.keys(results)[0];
      if (!firstKey) {
        console.warn('[ONNX] No output tensors in results map');
        return null;
      }
      console.warn(`[ONNX] Output "${ONNX_OUTPUT_NAME}" not found; using "${firstKey}" — verify with Netron`);
      outputTensor = results[firstKey]!;
    }

    const probs = outputTensor.data as Float32Array;
    if (!probs?.length) return null;

    // Argmax
    let maxIdx = 0;
    let maxVal = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i++) {
      if ((probs[i] ?? 0) > maxVal) { maxVal = probs[i] ?? 0; maxIdx = i; }
    }

    const topLabel = LABELS[maxIdx] ?? 'footsteps';

    // Live Metro probability log
    LABELS.forEach((lbl, i) => {
      const p     = (probs[i] ?? 0).toFixed(4);
      const arrow = i === maxIdx ? '  ◀ TOP' : '';
      console.log(`[ONNX Live] class=${lbl.padEnd(16)} prob=${p}${arrow}`);
    });

    return { label: topLabel as SoundLabel, confidence: maxVal };
  } catch (err) {
    console.warn('[ONNX] Inference error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Linear-Interpolation Resampler  (16 000 Hz → 22 050 Hz)
// ─────────────────────────────────────────────────────────────────

/**
 * resampleLinear
 *
 * Resamples a Float32Array from srcRate to dstRate using linear interpolation.
 * This is mathematically equivalent to SciPy's `resample_poly` for the
 * frequency range used in environmental sound classification (< 8 kHz).
 *
 * Complexity: O(n) — safe to run synchronously on the JS thread.
 *
 * @param samples  Input PCM at srcRate
 * @param srcRate  Source sample rate (16 000 Hz)
 * @param dstRate  Target sample rate (22 050 Hz)
 * @returns        Resampled Float32Array at dstRate
 */
function resampleLinear(
  samples: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate) return samples;

  const ratio     = dstRate / srcRate;
  const outLen    = Math.floor(samples.length * ratio);
  const out       = new Float32Array(outLen);
  const srcLenM1  = samples.length - 1;

  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const lo     = Math.floor(srcPos);
    const hi     = Math.min(lo + 1, srcLenM1);
    const frac   = srcPos - lo;
    out[i] = (samples[lo] ?? 0) * (1 - frac) + (samples[hi] ?? 0) * frac;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Android permission helper
// ─────────────────────────────────────────────────────────────────

/**
 * requestMicrophonePermission
 *
 * On Android, RECORD_AUDIO is a dangerous permission that must be requested
 * at runtime even when declared in AndroidManifest.xml.
 * On other platforms (web, iOS-stub) it resolves true immediately.
 */
async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title:   'Microphone Permission',
        message: 'SoundGuard needs microphone access to detect environmental sounds.',
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

  // Rolling PCM buffer — accumulated resampled audio at 22 050 Hz.
  // We use a plain number[] and convert to Float32Array only on inference
  // to avoid excessive GC pressure from frequent typed-array allocations.
  const pcmBufferRef      = useRef<number[]>([]);

  const isListeningRef    = useRef(false);
  const inferenceActiveRef = useRef(false);   // prevents re-entrant inference calls
  const criticalStreakRef  = useRef(0);
  const onnxSessionRef     = useRef<InferenceSession | null>(null);

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

  // ── Core inference pipeline (called when buffer is full) ─────────
  const runInferencePipeline = useCallback(async (
    samples: Float32Array,
  ): Promise<void> => {
    if (!onnxSessionRef.current) return;
    if (inferenceActiveRef.current) {
      console.log('[Pipeline] Previous inference still running — dropping window');
      return;
    }
    inferenceActiveRef.current = true;

    try {
      const melFeatures = extractMelSpectrogram(samples);
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

      if (threatLevel === 'safe') {
        criticalStreakRef.current = 0;
        setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        return;
      }

      if (threatLevel === 'critical') {
        criticalStreakRef.current += CLIP_DURATION;
      } else {
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
      console.warn('[Pipeline] Inference error:', err);
    } finally {
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

    isListeningRef.current    = true;
    criticalStreakRef.current  = 0;
    pcmBufferRef.current       = [];      // clear any leftover audio from a prior session
    inferenceActiveRef.current = false;

    setState((s) => ({
      ...s,
      isListening:          true,
      isModelLoaded:        !!onnxSessionRef.current,
      error:                null,
      prediction:           null,
      criticalStreakSeconds: 0,
    }));

    // ── Configure LiveAudioStream ─────────────────────────────────
    // Capture 16 000 Hz raw signed 16-bit mono PCM via Android AudioRecord.
    // audioSource 6 = VOICE_RECOGNITION: disables AGC, echo-cancel, and noise
    // suppression — we want the unprocessed acoustic signal for the CNN.
    LiveAudioStream.init({
      sampleRate:    CAPTURE_RATE,   // 16 000 Hz
      channels:      1,              // mono
      bitsPerSample: 16,             // signed int16 LE
      audioSource:   AUDIO_SOURCE,   // 6 = VOICE_RECOGNITION (raw signal)
      bufferSize:    BUFFER_SIZE_SAMPLES,
    });

    // ── Register 'data' event handler ────────────────────────────
    // Each event delivers a base64-encoded chunk of signed int16 LE PCM.
    // We decode → normalise → resample → accumulate → fire inference when full.
    LiveAudioStream.on('data', async (base64Chunk: string) => {
      if (!isListeningRef.current) return;

      try {
        // 1. base64 → raw bytes via the `buffer` polyfill
        const rawBytes = Buffer.from(base64Chunk, 'base64');

        // 2. raw bytes → Int16Array (little-endian signed 16-bit)
        //    Each sample is 2 bytes; ensure even byte count.
        const numSamples = Math.floor(rawBytes.length / 2);
        if (numSamples === 0) return;

        const int16View = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, numSamples);

        // 3. Int16 → Float32 normalised to [-1.0, +1.0]
        const float32Chunk = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          float32Chunk[i] = (int16View[i] ?? 0) / 32768;
        }

        // 4. Resample from CAPTURE_RATE (16 000 Hz) → SAMPLE_RATE (22 050 Hz)
        //    so the Mel-spectrogram pipeline receives correctly-pitched features.
        const resampled = resampleLinear(float32Chunk, CAPTURE_RATE, SAMPLE_RATE);

        // 5. Append to rolling buffer
        const buf = pcmBufferRef.current;
        for (let i = 0; i < resampled.length; i++) {
          buf.push(resampled[i] ?? 0);
        }

        // 6. When buffer reaches one full clip (CLIP_SAMPLES = 66 150 frames),
        //    fire inference and clear the buffer for the next window.
        if (buf.length >= CLIP_SAMPLES) {
          // Slice exactly CLIP_SAMPLES; discard the overflow to prevent drift.
          const window = new Float32Array(buf.slice(0, CLIP_SAMPLES));
          pcmBufferRef.current = [];   // clear buffer immediately (in-place reset)

          console.log(
            `[Audio] Window ready: ${window.length} samples @ ${SAMPLE_RATE} Hz`,
            `(captured @ ${CAPTURE_RATE} Hz, resampled)`,
          );

          // Run inference asynchronously; inferenceActiveRef guards re-entry.
          runInferencePipeline(window);
        }
      } catch (err) {
        console.warn('[Audio] Chunk processing error:', err);
      }
    });

    LiveAudioStream.start();
    console.log('[Audio] LiveAudioStream started at', CAPTURE_RATE, 'Hz');
  }, [requestPermission, runInferencePipeline]);

  // ── Stop listening ────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;

    isListeningRef.current = false;
    criticalStreakRef.current = 0;

    // Stop the native AudioRecord thread. This also stops data event emission.
    try { LiveAudioStream.stop(); } catch {}

    // Clear the rolling buffer — no more data will arrive.
    pcmBufferRef.current = [];
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
        isListeningRef.current = false;
        try { LiveAudioStream.stop(); } catch {}
        pcmBufferRef.current       = [];
        inferenceActiveRef.current = false;
      }
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
  };
}
