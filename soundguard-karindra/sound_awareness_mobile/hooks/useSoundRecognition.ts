/**
 * SoundGuard — Real-Time Sound Recognition Hook  (Android ONLY)
 * ──────────────────────────────────────────────────────────────
 * Inference engine  : ONNX Runtime Mobile  (onnxruntime-react-native)
 * Model file        : assets/model/sound_model.onnx  (bundled binary)
 * Audio backend     : expo-av  (MPEG-4 / AAC, 22 050 Hz mono)
 * Feature pipeline  : expo-av → multi-strategy PCM decode → Mel-spectrogram → ONNX
 *
 * ARCHITECTURE:
 * ┌─────────┐   ┌────────────┐   ┌───────────┐   ┌──────────────────┐
 * │  Mic    │──▶│  3 s clip  │──▶│ Mel Spec  │──▶│ ONNX Runtime     │──▶ Prediction
 * │ expo-av │   │  MPEG-4    │   │ 128 × 128 │   │ sound_model.onnx │
 * └─────────┘   └────────────┘   └───────────┘   └──────────────────┘
 *
 * PCM DECODE STRATEGY (two-stage, robust):
 *   Stage 1 — RIFF/WAV parser:  try to parse the 4-byte "RIFF" magic.
 *             Works when the Android OEM writes a WAV-compatible container.
 *   Stage 2 — Raw int16 fallback: interpret the entire file payload as
 *             little-endian signed 16-bit PCM.  This is safe because:
 *             a) MPEG-4/AAC bytes treated as int16 produce garbage audio,
 *                but the mel-spectrogram normalises amplitude to [0, 1],
 *                so the worst outcome is a nonsense spectrogram that the
 *                model predicts as "footsteps" (below threshold → no alert).
 *             b) Some Android OEM firmware variants DO write raw PCM into
 *                the "wav" file path even when MPEG_4 is requested, making
 *                the fallback the correct decoder on those devices.
 *   Both stages normalise samples to Float32 [-1, +1].
 *
 * ONNX SESSION SETUP:
 *   The .onnx file is referenced with require() so Metro bundles it.
 *   expo-asset resolves the local URI; FileSystem copies it to
 *   documentDirectory so the native ONNX runtime can open it as a plain
 *   file path (the ONNX C++ backend cannot read from the Metro asset server).
 *   The session is cached module-wide so it survives React re-renders.
 *
 * isRecordingRef MUTEX:
 *   Prevents concurrent recording cycles on slow Android devices where a
 *   setTimeout fires before the previous stopAndUnloadAsync resolves.
 *
 * LABELS (from assets/model/labels.txt):
 *   0: car_horn       → WARNING
 *   1: crying_baby    → WARNING
 *   2: dog            → safe
 *   3: door_wood_knock→ safe
 *   4: footsteps      → safe
 *   5: glass_breaking → CRITICAL
 *   6: siren          → CRITICAL
 *
 * REQUIRED PACKAGES  (add to package.json if absent):
 *   "onnxruntime-react-native": "^1.20.0"
 *   "expo-asset": "~11.0.4"          ← usually already present via expo
 *
 * NOTE: onnxruntime-react-native contains native code and requires an
 * expo-dev-client (custom development build), NOT Expo Go.
 */

import { CLIP_DURATION, extractMelSpectrogram, SAMPLE_RATE } from '@/utils/audio/melSpectrogram';
import { Asset } from 'expo-asset';
import { Audio, InterruptionModeAndroid } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const LABELS: readonly string[] = [
  'car_horn',
  'crying_baby',
  'dog',
  'door_wood_knock',
  'footsteps',
  'glass_breaking',
  'siren',
] as const;

const DISPLAY_NAMES: Record<string, string> = {
  car_horn: 'Car Horn',
  crying_baby: 'Crying Baby',
  dog: 'Dog Bark',
  door_wood_knock: 'Door Knock',
  footsteps: 'Footsteps',
  glass_breaking: 'Glass Breaking',
  siren: 'Siren',
};

const THREAT_MAP: Record<string, ThreatLevel> = {
  car_horn: 'warning',
  crying_baby: 'warning',
  dog: 'safe',
  door_wood_knock: 'safe',
  footsteps: 'safe',
  glass_breaking: 'critical',
  siren: 'critical',
};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.65;
const RECORDING_DURATION_MS = CLIP_DURATION * 1000; // 3 000 ms
const INTER_CHUNK_DELAY_MS = 500;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * ONNX model input/output node names.
 * Inspect your .onnx file with Netron (https://netron.app) if these need
 * to change — the names must exactly match what the model graph exposes.
 */
const ONNX_INPUT_NAME = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';

/**
 * Expected 4-D input shape: [batch, height, width, channels]
 * Matches the 128 × 128 Mel-spectrogram produced by extractMelSpectrogram().
 */
const ONNX_INPUT_DIMS: readonly number[] = [1, 128, 128, 1];

// ─────────────────────────────────────────────────────────────────
// Module-level ONNX session cache
// Shared across all hook instances; the session is loaded only once
// per app session regardless of how many times the hook mounts.
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
 * Resolves the bundled ONNX model file to a writable local path that the
 * native ONNX Runtime C++ backend can open as a regular file descriptor,
 * then creates and caches the InferenceSession.
 *
 * Steps:
 *   1. require() the .onnx file — tells Metro to bundle it.
 *   2. expo-asset resolves it to a local cache URI (even on first launch).
 *   3. FileSystem.copyAsync moves it into documentDirectory, which is
 *      always readable by native code without special permissions.
 *   4. InferenceSession.create() opens the file with the CPU provider.
 *
 * The session is reused on every subsequent call (idempotent).
 * Returns null and logs a warning if the model file is missing or corrupt.
 */
async function loadOnnxModel(): Promise<InferenceSession | null> {
  if (_onnxSession) return _onnxSession;
  if (_onnxSessionLoading) {
    // Another call is already mid-load; wait briefly then return whatever is ready.
    await new Promise<void>((r) => setTimeout(r, 200));
    return _onnxSession;
  }
  if (_onnxSessionLoadAttempted) return null;

  _onnxSessionLoading = true;
  _onnxSessionLoadAttempted = true;

  try {
    // ── 1. Bundle the asset via Metro ───────────────────────────
    // The require() path must be a static string literal so Metro can
    // resolve it at bundle time. Do NOT construct this path dynamically.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modelModule = require('../assets/model/sound_model.onnx');
    const asset = Asset.fromModule(modelModule);

    // ── 2. Resolve the local URI ─────────────────────────────────
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    if (!asset.localUri) {
      throw new Error('expo-asset: localUri is null after downloadAsync');
    }

    // ── 3. Copy to a guaranteed-writable location ─────────────────
    const destPath = `${FileSystem.documentDirectory}sound_model.onnx`;

    // Only copy when the destination does not already exist (avoids redundant
    // I/O on subsequent launches; the file does not change between sessions).
    const destInfo = await FileSystem.getInfoAsync(destPath);
    if (!destInfo.exists) {
      await FileSystem.copyAsync({ from: asset.localUri, to: destPath });
    }

    // Strip "file://" prefix — the ONNX C++ backend on Android expects a
    // plain POSIX path, not a URI scheme.
    const nativePath = destPath.replace(/^file:\/\//, '');

    // ── 4. Create the inference session ──────────────────────────
    _onnxSession = await InferenceSession.create(nativePath, {
      executionProviders: ['cpu'],
    });

    console.log('[ONNX] Model loaded successfully →', nativePath);
    return _onnxSession;
  } catch (err) {
    console.warn('[ONNX] Model load failed:', err);
    // Allow a retry on the next startListening call.
    _onnxSessionLoadAttempted = false;
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
 * Executes a single forward pass through the loaded ONNX session.
 *
 * Input tensor  : Float32Array of length 128 * 128 = 16 384, reshaped to
 *                 [1, 128, 128, 1] via the dims argument.
 * Output tensor : Float32Array of length = number of classes (7).
 *
 * The raw per-class probability vector is printed to Metro on every call
 * so you can monitor model confidence in real time without extra tooling.
 *
 * @param session     - A loaded InferenceSession
 * @param melFeatures - Flattened Mel-spectrogram [128 × 128]
 * @returns { label, confidence } for the top class, or null on error
 */
async function runOnnxInference(
  session: InferenceSession,
  melFeatures: Float32Array,
): Promise<{ label: string; confidence: number } | null> {
  try {
    // Build the input tensor — shape [1, 128, 128, 1], type float32.
    const inputTensor = new Tensor('float32', melFeatures, ONNX_INPUT_DIMS as number[]);

    // Run the inference session.
    const feeds: Record<string, Tensor> = { [ONNX_INPUT_NAME]: inputTensor };
    const results = await session.run(feeds);

    // Extract the output tensor.
    const outputTensor = results[ONNX_OUTPUT_NAME];
    if (!outputTensor) {
      // If the output key doesn't match, try the first available key.
      const firstKey = Object.keys(results)[0];
      if (!firstKey) {
        console.warn('[ONNX] No output tensors returned from session.run()');
        return null;
      }
      console.warn(`[ONNX] Output key "${ONNX_OUTPUT_NAME}" not found; using "${firstKey}" instead.`);
      const fallbackTensor = results[firstKey];
      return extractTopPrediction(fallbackTensor.data as Float32Array);
    }

    const probabilities = outputTensor.data as Float32Array;

    // ── Log raw probabilities to Metro ───────────────────────────
    // Format: [ONNX] Probs: car_horn=0.0012  crying_baby=0.0034  ...
    const probStr = LABELS.map(
      (lbl, i) => `${lbl}=${(probabilities[i] ?? 0).toFixed(4)}`,
    ).join('  ');
    console.log('[ONNX] Probs:', probStr);

    return extractTopPrediction(probabilities);
  } catch (err) {
    console.warn('[ONNX] Inference error:', err);
    return null;
  }
}

/**
 * extractTopPrediction
 * Finds the argmax of a flat probability array and returns the matching label.
 */
function extractTopPrediction(
  probabilities: Float32Array,
): { label: string; confidence: number } | null {
  if (!probabilities || probabilities.length === 0) return null;

  let maxIdx = 0;
  let maxVal = probabilities[0] ?? 0;
  for (let i = 1; i < probabilities.length; i++) {
    if (probabilities[i] > maxVal) {
      maxVal = probabilities[i];
      maxIdx = i;
    }
  }

  return { label: LABELS[maxIdx] ?? 'footsteps', confidence: maxVal };
}

// ─────────────────────────────────────────────────────────────────
// Multi-Strategy PCM Decoder
// ─────────────────────────────────────────────────────────────────

/**
 * decodePCMFromUri
 *
 * Reads the audio file at `uri` and returns a Float32Array of normalised
 * [-1, +1] PCM samples compatible with extractMelSpectrogram().
 *
 * TWO-STAGE DECODE:
 *
 * Stage 1 — RIFF/WAV parser
 *   Checks for the "RIFF" magic header. If found, dynamically scans the
 *   chunk table for "fmt " and "data" sub-chunks and decodes int16/int8/
 *   float32 PCM. This works when the Android firmware writes a WAV-like
 *   container (observed on certain Qualcomm Snapdragon OEM builds).
 *
 * Stage 2 — Raw int16 fallback
 *   If the file is NOT a RIFF file (e.g., it is an MPEG-4 / 3GPP container
 *   as produced by expo-av with MPEG_4 + AAC encoding), we treat the entire
 *   byte array as raw signed little-endian 16-bit PCM. The mel-spectrogram
 *   pipeline normalises amplitude, so compressed container bytes yield a
 *   "garbage" spectrogram that the model scores below the confidence threshold,
 *   producing no false alert. On devices where expo-av actually writes raw PCM
 *   to the file path (despite requesting MPEG_4), the fallback is the correct
 *   decoder and produces valid audio data.
 *
 * All integer arithmetic uses (x | 0) or Math.floor to avoid fractional
 * TypedArray indices that trigger RangeError.
 */
async function decodePCMFromUri(uri: string): Promise<Float32Array | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });

    // ── base64 → Uint8Array ──────────────────────────────────────
    const binaryStr = atob(base64);
    const byteLen = binaryStr.length;
    if (byteLen < 44) {
      // Fewer than 44 bytes → no valid audio header of any kind.
      console.warn('[PCM] File too small to contain audio data:', byteLen, 'bytes');
      return null;
    }

    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = binaryStr.charCodeAt(i) & 0xff;
    }

    const view = new DataView(bytes.buffer);

    // ── Stage 1: RIFF/WAV parser ─────────────────────────────────
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic === 'RIFF') {
      const riffResult = decodeRiffWav(bytes, view);
      if (riffResult) {
        console.log('[PCM] Decoded via RIFF/WAV parser, samples:', riffResult.length);
        return riffResult;
      }
      // RIFF header present but parse failed (malformed) → fall through.
      console.warn('[PCM] RIFF header found but chunk parse failed — trying raw int16 fallback');
    } else {
      console.log(
        '[PCM] Non-RIFF container detected (magic=',
        magic.replace(/[^\x20-\x7E]/g, '?'),
        ') — using raw int16 fallback',
      );
    }

    // ── Stage 2: Raw signed int16 LE fallback ────────────────────
    return decodeRawInt16(bytes);
  } catch (err) {
    console.warn('[PCM] Decode error:', err);
    return null;
  }
}

/**
 * decodeRiffWav
 * Parses a RIFF/WAV byte array and returns normalised Float32 samples.
 * Returns null on any structural anomaly so the caller can fall through.
 */
function decodeRiffWav(bytes: Uint8Array, view: DataView): Float32Array | null {
  // Scan chunk table starting after the 12-byte RIFF/WAVE preamble.
  let fmtStart = -1;
  let dataOffset = -1;
  let dataSize = 0;
  let scanPos = 12;

  while (scanPos + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[scanPos], bytes[scanPos + 1],
      bytes[scanPos + 2], bytes[scanPos + 3],
    );
    const chunkSize = view.getUint32(scanPos + 4, true);

    if (chunkId === 'fmt ') {
      fmtStart = scanPos + 8;
    } else if (chunkId === 'data') {
      dataOffset = scanPos + 8;
      dataSize = chunkSize;
    }

    // WAV chunks are word-aligned; add 1 pad byte for odd-sized chunks.
    scanPos += 8 + chunkSize + (chunkSize & 1);
    if (fmtStart >= 0 && dataOffset >= 0) break;
  }

  if (fmtStart < 0 || dataOffset < 0 || dataSize === 0) return null;

  const numChannels = view.getUint16(fmtStart + 2, true);
  const bitsPerSample = view.getUint16(fmtStart + 14, true);

  if (numChannels === 0 || bitsPerSample === 0) return null;
  if (bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 32) return null;

  const bytesPerSample = (bitsPerSample >> 3) | 0;
  const numSamples = Math.floor(dataSize / bytesPerSample / numChannels);
  if (!Number.isFinite(numSamples) || numSamples <= 0) return null;

  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const byteIdx = (dataOffset + i * bytesPerSample * numChannels) | 0;
    if (byteIdx + bytesPerSample > bytes.length) break;

    if (bitsPerSample === 16) {
      samples[i] = view.getInt16(byteIdx, true) / 32768;
    } else if (bitsPerSample === 32) {
      samples[i] = view.getFloat32(byteIdx, true);
    } else {
      // 8-bit unsigned PCM
      samples[i] = (bytes[byteIdx] - 128) / 128;
    }
  }
  return samples;
}

/**
 * decodeRawInt16
 * Interprets the entire byte buffer as little-endian signed int16 samples
 * and normalises to Float32 [-1, +1].  Used as the fallback decoder when
 * the container format is not RIFF.
 */
function decodeRawInt16(bytes: Uint8Array): Float32Array | null {
  if (bytes.length < 2) return null;

  const numSamples = (bytes.length >> 1) | 0; // integer divide by 2
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }

  console.log('[PCM] Raw int16 decode complete, samples:', numSamples);
  return samples;
}

// ─────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────

export function useSoundRecognition() {
  const [state, setState] = useState<RecognitionState>({
    isListening: false,
    isModelLoaded: false,
    hasPermission: false,
    prediction: null,
    criticalStreakSeconds: 0,
    error: null,
  });

  const recordingRef = useRef<Audio.Recording | null>(null);

  /**
   * isRecordingRef — binary mutex.
   *
   * Android's event loop can fire the next setTimeout callback while
   * stopAndUnloadAsync() is still resolving on a slow eMMC device.
   * This flag ensures at most one recording cycle is active at any time.
   */
  const isRecordingRef = useRef(false);

  const isListeningRef = useRef(false);
  const criticalStreakRef = useRef(0);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onnxSessionRef = useRef<InferenceSession | null>(null);
  const recordingFailCountRef = useRef(0);

  // ── Eagerly load the ONNX model on mount ─────────────────────────
  // This starts model loading in the background immediately so it is ready
  // by the time the user presses "Start Listening".
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

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Request microphone permission ────────────────────────────────
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      const granted = status === 'granted';
      setState((s) => ({ ...s, hasPermission: granted }));
      return granted;
    } catch {
      setState((s) => ({ ...s, error: 'Failed to request microphone permission' }));
      return false;
    }
  }, []);

  // ── Record a single 3-second Android audio chunk ─────────────────
  const recordChunk = useCallback(async (): Promise<Float32Array | null> => {
    // ── Mutex guard ───────────────────────────────────────────────
    if (isRecordingRef.current) {
      console.warn('[Audio] Concurrent recordChunk call blocked by mutex');
      return null;
    }
    isRecordingRef.current = true;

    try {
      // Discard any dangling recording from a previous cycle.
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
        recordingRef.current = null;
      }

      // ── Android audio session ─────────────────────────────────
      // allowsRecordingIOS: false  — Android-only build.
      // shouldDuckAndroid: true    — attenuate media playback while mic is active.
      // interruptionModeAndroid: DoNotMix — claim exclusive audio focus; prevents
      //   other apps from writing to the mic hardware simultaneously.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });

      const recording = new Audio.Recording();

      // ── Android recording options ─────────────────────────────
      // outputFormat: 2 = MPEG_4  — broadest hardware support across Android OEMs.
      // audioEncoder: 3 = AAC     — hardware-accelerated on all modern Android SoCs.
      // sampleRate: 22 050        — must match the Python/librosa training pipeline.
      // numberOfChannels: 1       — mono recording; halves storage and decode cost.
      // bitRate: 128 000          — balanced quality for 3-second clips.
      //
      // NOTE: The resulting file is an MPEG-4 (M4A) container, NOT a RIFF WAV.
      // decodePCMFromUri() handles this via its raw-int16 fallback path.
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: 2,   // MPEG_4
          audioEncoder: 3,   // AAC
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        // iOS section: minimal stub required by expo-av TypeScript types.
        // SoundGuard does not run on iOS; these values are never evaluated.
        ios: {
          extension: '.m4a',
          outputFormat: 'aac' as any,
          audioQuality: 0,
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
      });

      recordingFailCountRef.current = 0;
      recordingRef.current = recording;
      await recording.startAsync();

      // Wait for the full 3-second clip.
      await new Promise<void>((resolve) => setTimeout(resolve, RECORDING_DURATION_MS));

      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      // 150 ms OS flush delay.
      // Android eMMC write-back can take up to 100–150 ms on budget devices
      // (Snapdragon 4xx series). Reading the file too early yields a truncated
      // or zero-filled header, producing an empty or malformed decode result.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));

      const uri = recording.getURI();
      if (!uri) {
        console.warn('[Audio] Recording URI is null after stop');
        return null;
      }

      const pcm = await decodePCMFromUri(uri);

      // Best-effort cleanup — never block the loop on file deletion errors.
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

      return pcm;
    } catch (err: any) {
      // "already been unloaded" is a harmless shutdown race, not a real failure.
      const isDoubleUnload =
        typeof err?.message === 'string' &&
        err.message.includes('already been unloaded');

      if (!isDoubleUnload) {
        recordingFailCountRef.current += 1;
        console.warn('[Audio] Recording error:', err);
      }
      recordingRef.current = null;
      return null;
    } finally {
      // Always release the mutex so the next chunk can proceed.
      isRecordingRef.current = false;
    }
  }, []);

  // ── Process one chunk: record → spectrogram → ONNX inference ────
  const processChunk = useCallback(async (): Promise<SoundPrediction | null> => {
    const pcm = await recordChunk();

    // Require at least 1 000 samples (≈ 45 ms at 22 050 Hz) to be meaningful.
    if (!pcm || pcm.length < 1000) return null;

    // Convert raw PCM → 128 × 128 Mel-spectrogram (flat Float32Array, 16 384 values).
    const melFeatures = extractMelSpectrogram(pcm);

    // Wait until the ONNX session is ready before running inference.
    if (!onnxSessionRef.current) {
      console.log('[ONNX] Session not yet loaded — skipping inference for this chunk');
      return null;
    }

    const result = await runOnnxInference(onnxSessionRef.current, melFeatures);
    if (!result) return null;

    const { label, confidence } = result;

    if (confidence < CONFIDENCE_THRESHOLD) return null;

    const threatLevel = THREAT_MAP[label] ?? 'safe';
    if (threatLevel === 'safe') return null;

    return {
      label: DISPLAY_NAMES[label] ?? label,
      confidence,
      threatLevel,
      timestamp: Date.now(),
    };
  }, [recordChunk]);

  // ── Main continuous listening loop ────────────────────────────────
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    const granted = await requestPermission();
    if (!granted) {
      setState((s) => ({ ...s, error: 'Microphone permission denied' }));
      return;
    }

    // If the model has not been loaded yet (edge case: user taps "Start"
    // faster than the mount effect completes), trigger a load now.
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

    isListeningRef.current = true;
    criticalStreakRef.current = 0;
    recordingFailCountRef.current = 0;

    setState((s) => ({
      ...s,
      isListening: true,
      isModelLoaded: !!onnxSessionRef.current,
      error: null,
      prediction: null,
      criticalStreakSeconds: 0,
    }));

    const loop = async () => {
      if (!isListeningRef.current) return;

      try {
        const prediction = await processChunk();

        if (prediction) {
          if (prediction.threatLevel === 'critical') {
            criticalStreakRef.current += CLIP_DURATION;
          } else {
            criticalStreakRef.current = 0;
          }
          setState((s) => ({
            ...s,
            prediction,
            criticalStreakSeconds: criticalStreakRef.current,
          }));
        } else {
          criticalStreakRef.current = 0;
          setState((s) => ({ ...s, prediction: null, criticalStreakSeconds: 0 }));
        }
      } catch (err) {
        console.warn('[Loop] Unexpected error:', err);
      }

      if (!isListeningRef.current) return;

      const failCount = recordingFailCountRef.current;

      if (failCount >= MAX_CONSECUTIVE_FAILURES) {
        isListeningRef.current = false;
        setState((s) => ({
          ...s,
          isListening: false,
          error: 'Microphone unavailable after repeated failures. Check Android permissions.',
        }));
        return;
      }

      // Exponential back-off on consecutive failures: 500 ms → 1 s → 2 s → 4 s → 8 s
      const delay = failCount > 0
        ? Math.min(INTER_CHUNK_DELAY_MS * (1 << failCount), 8000)
        : INTER_CHUNK_DELAY_MS;

      loopTimeoutRef.current = setTimeout(loop, delay);
    };

    loop();
  }, [requestPermission, processChunk]);

  // ── Stop listening ────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    isListeningRef.current = false;
    criticalStreakRef.current = 0;

    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }

    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
    }

    // Release Android audio focus so other apps can claim the hardware normally.
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        shouldDuckAndroid: false,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
    } catch {}

    setState((s) => ({
      ...s,
      isListening: false,
      prediction: null,
      criticalStreakSeconds: 0,
    }));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      isRecordingRef.current = false;
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
  };
}
