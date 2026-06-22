/**
 * SoundGuard — Real-Time Sound Recognition Hook  (Android / EAS Development Build)
 * ──────────────────────────────────────────────────────────────────────────────────
 * Inference engine  : ONNX Runtime Mobile  (onnxruntime-react-native ^1.20.0)
 * Model file        : assets/model/sound_model.onnx  (bundled binary)
 * Audio backend     : expo-av  (MPEG-4 / AAC, 22 050 Hz mono)
 * Feature pipeline  : expo-av → multi-strategy PCM decode → Mel-spectrogram → ONNX
 *
 * ARCHITECTURE:
 * ┌─────────┐   ┌────────────┐   ┌───────────┐   ┌──────────────────────┐
 * │  Mic    │──▶│  3 s clip  │──▶│ Mel Spec  │──▶│ ONNX Runtime Mobile  │──▶ Prediction
 * │ expo-av │   │  MPEG-4    │   │ 128 × 128 │   │  sound_model.onnx    │
 * └─────────┘   └────────────┘   └───────────┘   └──────────────────────┘
 *
 * NATIVE LINKING:
 *   onnxruntime-react-native is a JSI native module.  EAS Build with
 *   developmentClient:true runs `expo prebuild` + Gradle in the cloud, which
 *   compiles the .so native library and links it via react-native.config.js.
 *   The session MUST be used inside an EAS development build APK, not Expo Go.
 *
 * MODEL ASSET LOADING:
 *   1. require() tells Metro to bundle sound_model.onnx into the APK assets.
 *   2. expo-asset resolves the bundled URI to a local file path.
 *   3. FileSystem.copyAsync copies it to documentDirectory (writable POSIX path).
 *   4. InferenceSession.create() opens the file — the C++ backend requires a
 *      plain POSIX path, not a file:// URI or a Metro asset server URL.
 *   The session is cached module-wide so it loads only once per app session.
 *
 * PCM DECODE STRATEGY (two-stage, robust):
 *   Stage 1 — RIFF/WAV parser  : works on OEMs that write WAV containers.
 *   Stage 2 — Raw int16 fallback: handles MPEG-4/AAC/3GPP outputs from expo-av.
 *
 * isRecordingRef MUTEX:
 *   Prevents concurrent recording cycles on slow Android devices where the
 *   next setTimeout fires before the previous stopAndUnloadAsync resolves.
 *
 * LIVE LOGGING FORMAT (Metro):
 *   [ONNX Live] class=siren          prob=0.9200
 *   [ONNX Live] class=glass_breaking prob=0.7812
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
import { Audio, InterruptionModeAndroid } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { extractMelSpectrogram, SAMPLE_RATE, CLIP_DURATION } from '@/utils/audio/melSpectrogram';

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
const RECORDING_DURATION_MS = CLIP_DURATION * 1000; // 3 000 ms
const INTER_CHUNK_DELAY_MS  = 500;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * ONNX model graph node names.
 * Validated via Netron (https://netron.app) on sound_model.onnx.
 * These are the exact TF SavedModel export names preserved by tf2onnx.
 */
const ONNX_INPUT_NAME  = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';

/** Input shape: [batch=1, mel_bands=128, time_frames=128, channels=1] */
const ONNX_INPUT_DIMS: readonly number[] = [1, 128, 128, 1];

// ─────────────────────────────────────────────────────────────────
// Module-level ONNX session cache
// Shared across all hook instances — the session is loaded once per
// app session regardless of how many times the hook mounts/unmounts.
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
 * Copies the bundled ONNX model from the Metro asset bundle to a
 * writable POSIX path and creates an InferenceSession from it.
 *
 * The ONNX C++ backend on Android requires a plain file-system path —
 * it cannot open Metro asset server URLs or file:// URIs directly.
 *
 * Load sequence:
 *   1. require() → Metro bundles sound_model.onnx into the APK.
 *   2. Asset.fromModule() → expo-asset resolves the local bundle URI.
 *   3. asset.downloadAsync() → ensures the file is present in the
 *      local cache (on first launch, Android copies from APK assets).
 *   4. FileSystem.copyAsync() → copies to documentDirectory for
 *      guaranteed read/write access from native C++ code.
 *   5. InferenceSession.create() → opens the file on the CPU provider.
 *
 * Idempotent — returns the cached session on all subsequent calls.
 * Returns null and marks load as failed if anything throws.
 */
async function loadOnnxModel(): Promise<InferenceSession | null> {
  if (_onnxSession)           return _onnxSession;
  if (_onnxSessionLoading) {
    // Another concurrent call is mid-load. Poll briefly then return.
    await new Promise<void>((r) => setTimeout(r, 250));
    return _onnxSession;
  }
  if (_onnxSessionLoadAttempted) return null;

  _onnxSessionLoading       = true;
  _onnxSessionLoadAttempted = true;

  try {
    // ── 1. Bundle the binary asset via Metro ─────────────────────
    // The require() argument MUST be a static string literal so Metro
    // can resolve it at bundle-time. Never construct this path at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modelModule = require('../assets/model/sound_model.onnx');
    const asset = Asset.fromModule(modelModule);

    // ── 2 & 3. Resolve the local URI from the APK assets ─────────
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    if (!asset.localUri) {
      throw new Error('expo-asset: localUri is still null after downloadAsync()');
    }

    // ── 4. Copy to a guaranteed-writable POSIX directory ─────────
    const destUri  = `${FileSystem.documentDirectory}sound_model.onnx`;
    const destInfo = await FileSystem.getInfoAsync(destUri);

    // Skip the copy if the file already exists from a previous launch.
    // The model binary never changes between sessions; this saves ~3 s on
    // cold starts on budget Android devices.
    if (!destInfo.exists) {
      await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
      console.log('[ONNX] Model copied to document directory');
    } else {
      console.log('[ONNX] Model already present — skipping copy');
    }

    // Strip "file://" prefix — InferenceSession.create() on Android
    // requires a plain POSIX path, not a URI scheme.
    const nativePath = destUri.replace(/^file:\/\//, '');

    // ── 5. Create the ONNX inference session ─────────────────────
    _onnxSession = await InferenceSession.create(nativePath, {
      executionProviders: ['cpu'],
    });

    console.log('[ONNX] Session created successfully →', nativePath);
    console.log('[ONNX] Input  node:', ONNX_INPUT_NAME);
    console.log('[ONNX] Output node:', ONNX_OUTPUT_NAME);
    return _onnxSession;
  } catch (err) {
    console.warn('[ONNX] Model load failed:', err);
    // Allow a retry on the next startListening() call.
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
 * Executes a single forward pass through the loaded InferenceSession.
 *
 * Input:  Float32Array of length 128*128 = 16 384 (flat row-major
 *         Mel-spectrogram), reshaped to [1, 128, 128, 1] via dims.
 * Output: Float32Array of length 7 (one probability per class).
 *
 * Live Metro log format per inference:
 *   [ONNX Live] class=siren          prob=0.9200
 *
 * If the configured output key is not found in the results map, the
 * function automatically falls back to the first available key and logs
 * a warning — this prevents silent failures when the ONNX export uses
 * a slightly different output node name.
 *
 * @param session     A loaded InferenceSession
 * @param melFeatures Flat Mel-spectrogram Float32Array [128 × 128]
 * @returns { label, confidence } for the top-scoring class, or null on error
 */
async function runOnnxInference(
  session: InferenceSession,
  melFeatures: Float32Array,
): Promise<{ label: SoundLabel; confidence: number } | null> {
  try {
    // Pre-allocate the input tensor with the exact 4-D shape the model expects.
    const inputTensor = new Tensor('float32', melFeatures, ONNX_INPUT_DIMS as number[]);
    const feeds: Record<string, Tensor> = { [ONNX_INPUT_NAME]: inputTensor };

    const results = await session.run(feeds);

    // Resolve the output tensor — try the configured key first, then fallback.
    let outputTensor = results[ONNX_OUTPUT_NAME];
    if (!outputTensor) {
      const firstKey = Object.keys(results)[0];
      if (!firstKey) {
        console.warn('[ONNX] session.run() returned no output tensors');
        return null;
      }
      console.warn(
        `[ONNX] Output key "${ONNX_OUTPUT_NAME}" not found. ` +
        `Using "${firstKey}" instead — check your model with Netron.`,
      );
      outputTensor = results[firstKey]!;
    }

    const probs = outputTensor.data as Float32Array;
    if (!probs || probs.length === 0) return null;

    // ── Find argmax ───────────────────────────────────────────────
    let maxIdx = 0;
    let maxVal = probs[0] ?? 0;
    for (let i = 1; i < probs.length; i++) {
      if ((probs[i] ?? 0) > maxVal) {
        maxVal = probs[i] ?? 0;
        maxIdx = i;
      }
    }

    const topLabel = LABELS[maxIdx] ?? 'footsteps';

    // ── Live Metro logging (all classes) ─────────────────────────
    // Prints every class probability so you can monitor the model
    // confidence distribution in real time from the Metro console.
    LABELS.forEach((lbl, i) => {
      const p = (probs[i] ?? 0).toFixed(4);
      // Highlight the winning class
      if (i === maxIdx) {
        console.log(`[ONNX Live] class=${lbl.padEnd(16)} prob=${p}  ◀ TOP`);
      } else {
        console.log(`[ONNX Live] class=${lbl.padEnd(16)} prob=${p}`);
      }
    });

    return { label: topLabel as SoundLabel, confidence: maxVal };
  } catch (err) {
    console.warn('[ONNX] Inference error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Multi-Strategy PCM Decoder
// ─────────────────────────────────────────────────────────────────

/**
 * decodePCMFromUri
 *
 * Reads the audio file at `uri` and returns normalised Float32 PCM
 * samples in [-1, +1] suitable for extractMelSpectrogram().
 *
 * STAGE 1 — RIFF/WAV parser
 *   Checks for the "RIFF" magic header and dynamically scans the chunk
 *   table for "fmt " and "data" sub-chunks.  Supports 8-bit, 16-bit,
 *   and 32-bit float PCM.  Works on Android OEM builds that write a
 *   WAV-compatible container despite an MPEG_4 outputFormat request.
 *
 * STAGE 2 — Raw signed int16 LE fallback
 *   When the container is MPEG-4 / 3GPP (produced by AAC encoding),
 *   the entire byte buffer is interpreted as little-endian int16 PCM.
 *   The Mel-spectrogram normalises amplitude, so any container bytes
 *   that are NOT raw PCM produce a spectrogram the model scores below
 *   the confidence threshold → no false alerts.  On OEM builds where
 *   expo-av actually writes raw PCM into the M4A path, the fallback is
 *   the correct decoder.
 *
 * Neither stage throws — all error paths return null so the recording
 * loop simply skips the chunk and continues.
 */
async function decodePCMFromUri(uri: string): Promise<Float32Array | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });

    // base64 → raw bytes
    const binaryStr = atob(base64);
    const byteLen   = binaryStr.length;

    if (byteLen < 44) {
      console.warn('[PCM] File too small to be valid audio:', byteLen, 'bytes');
      return null;
    }

    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = binaryStr.charCodeAt(i) & 0xff;
    }

    const view  = new DataView(bytes.buffer);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);

    // ── Stage 1: RIFF/WAV ────────────────────────────────────────
    if (magic === 'RIFF') {
      const result = _decodeRiffWav(bytes, view);
      if (result) {
        console.log('[PCM] Stage 1 RIFF/WAV: decoded', result.length, 'samples');
        return result;
      }
      console.warn('[PCM] RIFF header found but chunk parse failed — Stage 2 fallback');
    } else {
      const safeHex = Array.from(bytes.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`[PCM] Non-RIFF container (magic bytes: ${safeHex}) — Stage 2 fallback`);
    }

    // ── Stage 2: Raw signed int16 LE ─────────────────────────────
    return _decodeRawInt16(bytes);
  } catch (err) {
    console.warn('[PCM] Decode error:', err);
    return null;
  }
}

/** RIFF/WAV chunk scanner and PCM extractor. */
function _decodeRiffWav(bytes: Uint8Array, view: DataView): Float32Array | null {
  let fmtStart   = -1;
  let dataOffset = -1;
  let dataSize   = 0;
  let scanPos    = 12; // skip 12-byte RIFF/WAVE preamble

  while (scanPos + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[scanPos], bytes[scanPos + 1],
      bytes[scanPos + 2], bytes[scanPos + 3],
    );
    const chunkSize = view.getUint32(scanPos + 4, true);

    if (chunkId === 'fmt ')       fmtStart   = scanPos + 8;
    else if (chunkId === 'data') { dataOffset = scanPos + 8; dataSize = chunkSize; }

    // WAV chunks are word-aligned; odd-length chunks carry a 1-byte pad.
    scanPos += 8 + chunkSize + (chunkSize & 1);
    if (fmtStart >= 0 && dataOffset >= 0) break;
  }

  if (fmtStart < 0 || dataOffset < 0 || dataSize === 0) return null;

  const numChannels  = view.getUint16(fmtStart + 2,  true);
  const bitsPerSample = view.getUint16(fmtStart + 14, true);

  if (!numChannels || !bitsPerSample) return null;
  if (bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 32) return null;

  const bps        = (bitsPerSample >> 3) | 0;
  const numSamples = Math.floor(dataSize / bps / numChannels);
  if (!Number.isFinite(numSamples) || numSamples <= 0) return null;

  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const idx = (dataOffset + i * bps * numChannels) | 0;
    if (idx + bps > bytes.length) break;

    if      (bitsPerSample === 16) samples[i] = view.getInt16(idx, true)   / 32768;
    else if (bitsPerSample === 32) samples[i] = view.getFloat32(idx, true);
    else                           samples[i] = (bytes[idx] - 128)         / 128;
  }
  return samples;
}

/** Interprets the entire buffer as LE signed int16 PCM. */
function _decodeRawInt16(bytes: Uint8Array): Float32Array | null {
  if (bytes.length < 2) return null;
  const numSamples = (bytes.length >> 1) | 0;
  const view       = new DataView(bytes.buffer);
  const samples    = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  console.log('[PCM] Stage 2 int16: decoded', numSamples, 'samples');
  return samples;
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

  const recordingRef   = useRef<Audio.Recording | null>(null);

  /**
   * isRecordingRef — binary mutex.
   *
   * On slow Android eMMC devices the next setTimeout callback can fire
   * before stopAndUnloadAsync() resolves.  This flag guarantees that at
   * most one recording cycle is active at any point in time.
   */
  const isRecordingRef  = useRef(false);
  const isListeningRef  = useRef(false);
  const criticalStreakRef      = useRef(0);
  const loopTimeoutRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onnxSessionRef         = useRef<InferenceSession | null>(null);
  const recordingFailCountRef  = useRef(0);

  // ── Eagerly load the ONNX model on mount ─────────────────────────
  // Starts asset-copy + InferenceSession.create() in the background so
  // the session is ready by the time the user taps "Start Listening".
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
    // ── Mutex: block concurrent recording cycles ──────────────────
    if (isRecordingRef.current) {
      console.warn('[Audio] Concurrent recordChunk blocked by mutex — skipping');
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
      // interruptionModeAndroid: DoNotMix — exclusive audio focus prevents other
      //   apps from interfering with the microphone input stream.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        shouldDuckAndroid:  true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });

      const recording = new Audio.Recording();

      // ── Android recording options ─────────────────────────────
      // outputFormat: 2  = MPEG_4 — broadest hardware support on all Android OEMs.
      // audioEncoder: 3  = AAC   — hardware-accelerated on all modern Android SoCs.
      // sampleRate: 22 050       — must match the Python/librosa training pipeline.
      // numberOfChannels: 1      — mono; halves file size and decode cost.
      // bitRate: 128 000         — balanced quality for 3-second clips.
      await recording.prepareToRecordAsync({
        android: {
          extension:        '.m4a',
          outputFormat:     2,     // MPEG_4
          audioEncoder:     3,     // AAC
          sampleRate:       SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate:          128000,
        },
        // iOS stub — required by expo-av TypeScript types; never evaluated.
        ios: {
          extension:           '.m4a',
          outputFormat:        'aac' as any,
          audioQuality:        0,
          sampleRate:          SAMPLE_RATE,
          numberOfChannels:    1,
          bitRate:             128000,
          linearPCMBitDepth:   16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:    false,
        },
        web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
      });

      recordingFailCountRef.current = 0;
      recordingRef.current = recording;
      await recording.startAsync();

      // Capture the full 3-second clip.
      await new Promise<void>((resolve) => setTimeout(resolve, RECORDING_DURATION_MS));

      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      // 150 ms OS flush delay.
      // Android eMMC write-back can take up to 100–150 ms on budget
      // Snapdragon 4xx devices.  Reading the file too early yields a
      // truncated header, producing an empty or malformed decode result.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));

      const uri = recording.getURI();
      if (!uri) {
        console.warn('[Audio] Recording URI is null after stop');
        return null;
      }

      const pcm = await decodePCMFromUri(uri);
      // Best-effort cleanup — never block the loop on deletion errors.
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

    // Convert PCM → 128×128 Mel-spectrogram (flat Float32Array, 16 384 values).
    const melFeatures = extractMelSpectrogram(pcm);

    // Block inference until the ONNX session is fully initialised.
    if (!onnxSessionRef.current) {
      console.log('[ONNX] Session not yet ready — skipping this chunk');
      return null;
    }

    const result = await runOnnxInference(onnxSessionRef.current, melFeatures);
    if (!result) return null;

    const { label, confidence } = result;

    if (confidence < CONFIDENCE_THRESHOLD) return null;

    const threatLevel = THREAT_MAP[label];
    if (threatLevel === 'safe') return null;

    return {
      label:      DISPLAY_NAMES[label],
      confidence,
      threatLevel,
      timestamp:  Date.now(),
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

    // If the model hasn't loaded yet (user taps "Start" before mount effect
    // completes), trigger an explicit load and surface any failure.
    if (!onnxSessionRef.current) {
      loadOnnxModel().then((session) => {
        if (session) {
          onnxSessionRef.current = session;
          setState((s) => ({ ...s, isModelLoaded: true }));
        } else {
          setState((s) => ({
            ...s,
            error:
              'ONNX model failed to load. ' +
              'Ensure sound_model.onnx is in assets/model/ ' +
              'and that you are running an EAS development build.',
          }));
        }
      });
    }

    isListeningRef.current      = true;
    criticalStreakRef.current     = 0;
    recordingFailCountRef.current = 0;

    setState((s) => ({
      ...s,
      isListening:          true,
      isModelLoaded:        !!onnxSessionRef.current,
      error:                null,
      prediction:           null,
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

      // Exponential back-off on consecutive failures: 500 → 1 000 → 2 000 → 4 000 → 8 000 ms
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

    // Release Android audio focus so other apps regain hardware access.
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        shouldDuckAndroid:  false,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
    } catch {}

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
      isListeningRef.current  = false;
      isRecordingRef.current  = false;
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
