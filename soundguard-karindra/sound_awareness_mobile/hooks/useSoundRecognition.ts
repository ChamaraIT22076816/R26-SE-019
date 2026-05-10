/**
 * SoundGuard — Real-Time Sound Recognition Hook
 * ───────────────────────────────────────────────
 * Full on-device inference pipeline:
 *   Microphone → 3s PCM chunks → Mel-spectrogram → TFLite model → Prediction
 *
 * ARCHITECTURE:
 * ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐
 * │  Mic    │───>│  PCM 3s    │───>│ Mel Spec  │───>│ TFLite   │──> Prediction
 * │ expo-av │    │  22050 Hz  │    │ 128×128   │    │ CNN      │
 * └─────────┘    └────────────┘    └───────────┘    └──────────┘
 *
 * EDGE-AI NOTES:
 * - The TFLite model requires a custom dev build (expo-dev-client).
 * - In Expo Go / development, the hook uses a simulation engine that
 *   processes real microphone audio but applies heuristic classification.
 * - The Mel-spectrogram extraction is real and production-ready.
 * - To enable real TF.js inference, install @tensorflow/tfjs and
 *   place sound_model.json + weights in assets/model/.
 *
 * LABELS (from assets/model/labels.txt):
 *   0: car_horn       → WARNING
 *   1: crying_baby     → WARNING
 *   2: dog             → LOW
 *   3: door_wood_knock → LOW
 *   4: footsteps       → LOW
 *   5: glass_breaking  → CRITICAL
 *   6: siren           → CRITICAL
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { extractMelSpectrogram, SAMPLE_RATE, CLIP_DURATION } from '@/utils/audio/melSpectrogram';

// ─── Types ───────────────────────────────────────────────────────

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

// ─── Label Configuration ─────────────────────────────────────────

const LABELS = [
  'car_horn',
  'crying_baby',
  'dog',
  'door_wood_knock',
  'footsteps',
  'glass_breaking',
  'siren',
];

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

const CONFIDENCE_THRESHOLD = 0.65;
const RECORDING_DURATION_MS = CLIP_DURATION * 1000; // 3000ms
const INTER_CHUNK_DELAY_MS = 500;

// ─── TF.js Model Loader ──────────────────────────────────────────

// Set this to the URL or local file:// URI of your TF.js model JSON once the
// model is ready (e.g. FileSystem.bundleDirectory + 'assets/model/sound_model.json').
// Keeping it null disables TF.js and uses the heuristic engine — safe for dev.
const TF_MODEL_URI: string | null = null;

// Module-level cache so the model is loaded once across all hook instances.
let _tfModel: any = null;
let _tfModelAttempted = false;

/**
 * Try to load the TF.js layers model from TF_MODEL_URI.
 *
 * FIX — ValueError: An InputLayer should be passed either a batchInputShape
 * or an inputShape:
 *   We fetch the model JSON at runtime (not via require — Metro cannot
 *   statically bundle a missing file), patch batch_input_shape onto the
 *   first layer if absent, then call tf.models.modelFromJSON with the
 *   corrected config.  This avoids both the bundler error and the shape error.
 *
 * Returns null when TF_MODEL_URI is unset, @tensorflow/tfjs is not installed,
 * or the model file is absent — the hook falls back to the heuristic engine.
 */
async function loadTFJSModel(): Promise<any | null> {
  if (!TF_MODEL_URI) return null;
  if (_tfModel) return _tfModel;
  if (_tfModelAttempted) return null;
  _tfModelAttempted = true;

  try {
    // Dynamic require — throws at runtime (not build time) when not installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tf = require('@tensorflow/tfjs');

    // Fetch the model JSON at runtime so Metro never tries to bundle it.
    // This also lets us patch the config before handing it to TF.js.
    const response = await fetch(TF_MODEL_URI);
    if (!response.ok) throw new Error(`Model fetch failed: ${response.status}`);
    const modelConfig: any = await response.json();

    // FIX — patch missing batch_input_shape on the first InputLayer so that
    // tf.models.modelFromJSON does not throw "An InputLayer should be passed
    // either a batchInputShape or an inputShape".
    const layers: any[] =
      modelConfig?.modelTopology?.config?.layers ??
      modelConfig?.config?.layers ??
      [];

    if (layers.length > 0) {
      layers[0].config = layers[0].config ?? {};
      if (!layers[0].config.batch_input_shape) {
        // [batch, height, width, channels] — matches the 128×128 Mel-spec input
        layers[0].config.batch_input_shape = [null, 128, 128, 1];
      }
    }

    _tfModel = await tf.models.modelFromJSON(modelConfig);
    console.log('[SoundRecognition] TF.js model loaded successfully');
    return _tfModel;
  } catch {
    // @tensorflow/tfjs not installed, model URI unreachable, or JSON malformed.
    console.log('[SoundRecognition] TF.js unavailable; using heuristic fallback');
    _tfModelAttempted = false; // allow a retry on next startListening
    return null;
  }
}

// ─── TF.js Inference ─────────────────────────────────────────────

async function runTFInference(
  tfModel: any,
  melFeatures: Float32Array,
): Promise<{ label: string; confidence: number } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tf = require('@tensorflow/tfjs');
    // Reshape flat [128*128] → [1, 128, 128, 1]
    const inputTensor = tf.tensor4d(melFeatures, [1, 128, 128, 1]);
    const outputTensor = tfModel.predict(inputTensor) as any;
    const predictions = (await outputTensor.data()) as Float32Array;
    inputTensor.dispose();
    outputTensor.dispose();

    let maxIdx = 0;
    let maxVal = predictions[0] ?? 0;
    for (let i = 1; i < predictions.length; i++) {
      if (predictions[i] > maxVal) {
        maxVal = predictions[i];
        maxIdx = i;
      }
    }

    return { label: LABELS[maxIdx] ?? 'footsteps', confidence: maxVal };
  } catch (err) {
    console.warn('[SoundRecognition] TF.js inference error:', err);
    return null;
  }
}

// ─── Heuristic Inference (development / fallback) ────────────────

function runHeuristicInference(melFeatures: Float32Array): { label: string; confidence: number } {
  const totalBins = melFeatures.length;

  let totalEnergy = 0;
  let highFreqEnergy = 0;
  let midFreqEnergy = 0;
  let lowFreqEnergy = 0;
  let maxEnergy = 0;
  let energyVariance = 0;

  for (let i = 0; i < totalBins; i++) {
    const val = melFeatures[i];
    totalEnergy += val;
    if (val > maxEnergy) maxEnergy = val;

    const melBand = Math.floor(i / 128);
    if (melBand < 40) lowFreqEnergy += val;
    else if (melBand < 90) midFreqEnergy += val;
    else highFreqEnergy += val;
  }

  const avgEnergy = totalEnergy / totalBins;

  for (let i = 0; i < totalBins; i++) {
    const diff = melFeatures[i] - avgEnergy;
    energyVariance += diff * diff;
  }
  energyVariance /= totalBins;

  const spectralRatio = highFreqEnergy / (totalEnergy + 1e-8);
  const midRatio = midFreqEnergy / (totalEnergy + 1e-8);

  if (avgEnergy < 0.08) return { label: 'footsteps', confidence: 0.3 };

  if (spectralRatio > 0.35 && energyVariance > 0.04) {
    return { label: 'glass_breaking', confidence: 0.7 + spectralRatio * 0.3 };
  }

  if (midRatio > 0.45 && energyVariance < 0.03 && avgEnergy > 0.3) {
    return { label: 'siren', confidence: 0.75 + midRatio * 0.2 };
  }

  if (midRatio > 0.4 && energyVariance > 0.05) {
    return { label: 'car_horn', confidence: 0.65 + midRatio * 0.2 };
  }

  if (lowFreqEnergy / (totalEnergy + 1e-8) > 0.5 && energyVariance > 0.03) {
    return { label: 'door_wood_knock', confidence: 0.55 };
  }

  return { label: 'footsteps', confidence: 0.35 };
}

// ─── Audio Decoding Helpers ──────────────────────────────────────

/**
 * Decode a WAV file URI to raw PCM Float32 samples.
 *
 * FIX — RangeError: The value given for the index must be between 0 and 2^53-1:
 *   Guard against bitsPerSample=0 or numChannels=0 in malformed WAV headers,
 *   which previously yielded Infinity/NaN as the Float32Array length.
 *   All index arithmetic is forced to integer via Math.floor / bitwise OR.
 */
async function decodePCMFromUri(uri: string): Promise<Float32Array | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as any,
    });

    // ── Base64 → Uint8Array ──────────────────────────────────────
    const binaryStr = atob(base64);
    const byteLen = binaryStr.length;
    if (byteLen === 0) return null;

    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      // & 0xff prevents charCodeAt returning values outside [0, 255]
      bytes[i] = binaryStr.charCodeAt(i) & 0xff;
    }

    const view = new DataView(bytes.buffer);

    // ── Verify RIFF header ───────────────────────────────────────
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (riff !== 'RIFF') {
      console.warn('[SoundRecognition] Not a valid WAV file');
      return null;
    }

    // ── Scan for fmt and data chunks ─────────────────────────────
    // We scan dynamically rather than using hardcoded offsets (22, 34) so the
    // parser works even when non-standard chunks appear before fmt .
    //
    // fmt chunk data layout (PCM, offsets relative to chunk data start):
    //   +0  audio format    (uint16) — 1 = PCM
    //   +2  numChannels     (uint16)
    //   +4  sample rate     (uint32)
    //   +8  byte rate       (uint32)
    //  +12  block align     (uint16)
    //  +14  bits per sample (uint16)
    let fmtDataStart = -1;
    let dataOffset = -1;
    let dataSize = 0;

    let scanPos = 12; // skip RIFF/WAVE 12-byte preamble
    while (scanPos + 8 <= bytes.length) {
      const chunkId = String.fromCharCode(
        bytes[scanPos], bytes[scanPos + 1],
        bytes[scanPos + 2], bytes[scanPos + 3],
      );
      const chunkSize = view.getUint32(scanPos + 4, true);

      if (chunkId === 'fmt ') {
        fmtDataStart = scanPos + 8;
      } else if (chunkId === 'data') {
        dataOffset = scanPos + 8;
        dataSize = chunkSize;
      }

      // Advance; WAV chunks are word-aligned — skip a pad byte when size is odd.
      scanPos += 8 + chunkSize + (chunkSize & 1);

      if (fmtDataStart >= 0 && dataOffset >= 0) break;
    }

    if (fmtDataStart < 0 || dataOffset < 0 || dataSize === 0) {
      console.warn('[SoundRecognition] WAV missing fmt or data chunk');
      return null;
    }

    // ── Read format params from the fmt chunk ────────────────────
    const numChannels = view.getUint16(fmtDataStart + 2, true);
    const bitsPerSample = view.getUint16(fmtDataStart + 14, true);

    if (bitsPerSample === 0 || numChannels === 0) {
      console.warn('[SoundRecognition] Invalid WAV header: bitsPerSample or numChannels is 0');
      return null;
    }

    if (bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 32) {
      console.warn('[SoundRecognition] Unsupported bitsPerSample:', bitsPerSample);
      return null;
    }

    // Integer division via bitwise OR — prevents fractional bytesPerSample.
    const bytesPerSample = (bitsPerSample >> 3) | 0;

    // Clamp to a safe integer before passing to Float32Array constructor.
    const rawNumSamples = dataSize / bytesPerSample / numChannels;
    const numSamples = Math.floor(rawNumSamples);

    if (!Number.isFinite(numSamples) || numSamples <= 0) {
      console.warn('[SoundRecognition] Computed numSamples is invalid:', numSamples);
      return null;
    }

    // ── Convert to Float32 ───────────────────────────────────────
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      // Force integer byte index to avoid TypedArray RangeError on fractional values.
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
  } catch (err) {
    console.warn('[SoundRecognition] PCM decode error:', err);
    return null;
  }
}

// ─── Main Hook ───────────────────────────────────────────────────

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
  const isListeningRef = useRef(false);
  const isPreparingRef = useRef(false);
  const criticalStreakRef = useRef(0);
  const loopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tfModelRef = useRef<any>(null);
  // Tracks consecutive recording prepare failures for exponential back-off.
  const recordingFailCountRef = useRef(0);

  // ── Request microphone permission ──
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      const granted = status === 'granted';
      setState((s) => ({ ...s, hasPermission: granted }));
      return granted;
    } catch {
      setState((s) => ({ ...s, error: 'Failed to request mic permission' }));
      return false;
    }
  }, []);

  // ── Record a single 3-second chunk ──
  const recordChunk = useCallback(async (): Promise<Float32Array | null> => {
    // FIX — Only one Recording object can be prepared at a given time:
    //   isPreparingRef blocks re-entrant calls while a recording is being set up.
    if (isPreparingRef.current) return null;
    isPreparingRef.current = true;

    try {
      // Always stop and unload any dangling recording before creating a new one.
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {}
        recordingRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        android: {
          extension: '.wav',
          outputFormat: 2,   // MPEG_4 container
          audioEncoder: 3,   // AAC encoder (AMR_NB was 8 kHz-only, incompatible with 22050)
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          // FIX: 'lpcm' is the correct Core Audio 4CC for LinearPCM.
          // 'linearPCM' was not recognised → NSOSStatusErrorDomain Code=1718449215 ('form').
          outputFormat: 'lpcm' as any,
          audioQuality: 127, // MAX
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/wav',
          bitsPerSecond: 128000,
        },
      });

      // prepareToRecordAsync succeeded — reset the failure streak.
      recordingFailCountRef.current = 0;
      recordingRef.current = recording;
      await recording.startAsync();

      await new Promise((resolve) => setTimeout(resolve, RECORDING_DURATION_MS));

      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      // Give the OS 100 ms to finish flushing the WAV file to disk before reading.
      // Without this, the fmt chunk bytes can be zero on the first read attempt.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const uri = recording.getURI();
      if (!uri) {
        console.warn('[SoundRecognition] Recording URI is null after stop');
        return null;
      }

      const pcm = await decodePCMFromUri(uri);
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      return pcm;
    } catch (err: any) {
      // "already been unloaded" is expected when stopListening() fires mid-recording.
      // Don't count it as a failure or log it — it's a clean shutdown race, not a bug.
      const isDoubleUnload = String(err?.message ?? '').includes('already been unloaded');
      if (!isDoubleUnload) {
        recordingFailCountRef.current += 1;
        console.warn('[SoundRecognition] Recording error:', err);
      }
      recordingRef.current = null;
      return null;
    } finally {
      // Always release the flag so the next chunk can proceed.
      isPreparingRef.current = false;
    }
  }, []);

  // ── Process a single chunk: record → spectrogram → inference ──
  const processChunk = useCallback(async (): Promise<SoundPrediction | null> => {
    const pcm = await recordChunk();
    if (!pcm || pcm.length < 1000) return null;

    const melFeatures = extractMelSpectrogram(pcm);

    // Prefer TF.js model inference; fall back to heuristic when unavailable.
    let result = tfModelRef.current
      ? await runTFInference(tfModelRef.current, melFeatures)
      : null;

    if (!result) {
      result = runHeuristicInference(melFeatures);
    }

    const { label, confidence } = result;

    if (confidence < CONFIDENCE_THRESHOLD) return null;

    const threatLevel = THREAT_MAP[label] || 'safe';
    if (threatLevel === 'safe') return null;

    return {
      label: DISPLAY_NAMES[label] || label,
      confidence,
      threatLevel,
      timestamp: Date.now(),
    };
  }, [recordChunk]);

  // ── Main listening loop ──
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    const hasPermission = await requestPermission();
    if (!hasPermission) {
      setState((s) => ({ ...s, error: 'Microphone permission denied' }));
      return;
    }

    // Attempt TF.js model load in the background — does not block listening.
    // On success, subsequent chunks use real model inference automatically.
    if (!tfModelRef.current) {
      loadTFJSModel().then((model) => {
        if (model) {
          tfModelRef.current = model;
          setState((s) => ({ ...s, isModelLoaded: true }));
        }
      });
    }

    isListeningRef.current = true;
    criticalStreakRef.current = 0;
    recordingFailCountRef.current = 0;
    setState((s) => ({
      ...s,
      isListening: true,
      // isModelLoaded reflects whether TF.js model is ready; heuristic always works.
      isModelLoaded: !!tfModelRef.current,
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
          setState((s) => ({
            ...s,
            prediction: null,
            criticalStreakSeconds: 0,
          }));
        }
      } catch (err) {
        console.warn('[SoundRecognition] Loop error:', err);
      }

      if (!isListeningRef.current) return;

      const failCount = recordingFailCountRef.current;

      // After 5 consecutive prepare failures, stop and surface an error rather
      // than spamming the log every 500 ms forever.
      if (failCount >= 5) {
        isListeningRef.current = false;
        setState((s) => ({
          ...s,
          isListening: false,
          error: 'Microphone unavailable. Check permissions and try again.',
        }));
        return;
      }

      // Exponential back-off: 500 ms → 1 s → 2 s → 4 s → 8 s
      const delay = failCount > 0
        ? Math.min(INTER_CHUNK_DELAY_MS * (1 << failCount), 8000)
        : INTER_CHUNK_DELAY_MS;

      loopTimeoutRef.current = setTimeout(loop, delay);
    };

    loop();
  }, [requestPermission, processChunk]);

  // ── Stop listening ──
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

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {}

    setState((s) => ({
      ...s,
      isListening: false,
      prediction: null,
      criticalStreakSeconds: 0,
    }));
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      isPreparingRef.current = false;
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
