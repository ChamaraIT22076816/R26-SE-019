/**
 * SoundGuard — Real-Time Sound Recognition Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * A framework-free singleton that owns audio capture, feature extraction, ONNX
 * inference and detection state. React binds to it through EngineProvider via
 * `useSyncExternalStore`; the engine itself imports nothing from React.
 *
 * Pipeline
 *   LiveAudioStream (16 kHz Int16 PCM, VOICE_RECOGNITION source)
 *     → Float32 normalise → linear resample to 22.05 kHz
 *     → continuous 3 s circular buffer
 *     → every `hop` seconds: linearise → RMS gate → mel-spectrogram → ONNX
 *     → suppression / mute filtering → publish → history
 *
 * ── Why detections used to reach the UI late ────────────────────────────────
 *
 * Four separate defects compounded:
 *
 *   1. Feature extraction blocked the JS thread for 1–2 s per window (see
 *      melSpectrogram.ts). React could not commit a render, so state written by
 *      the pipeline sat in the queue behind the next window's DSP. Fixed by the
 *      sparse mel basis plus cooperative yielding.
 *
 *   2. The buffer only advanced on chunks that passed the chunk-level silence
 *      gate, so in a quiet room a 3 s window took far longer than 3 s of
 *      wall-clock to assemble. A bark could be classified ten seconds after it
 *      happened. Replaced with a true circular buffer that always advances, and
 *      an analysis cadence measured in samples: a detection is now surfaced
 *      within one hop (0.6–1.5 s, sensitivity-dependent) of the sound.
 *
 *   3. Windows arriving while an inference was in flight were dropped
 *      entirely. The hop schedule now resynchronises after each analysis
 *      instead of discarding audio.
 *
 *   4. Seven `console.log` lines per inference crossed the bridge on every
 *      window. With a debugger attached that alone costs tens of milliseconds.
 *      All diagnostics are now behind `DEBUG`, off by default.
 *
 * State is published immutably and only when a value actually changes, so a
 * render is scheduled for real transitions and never for steady-state noise.
 * The audio level meter deliberately bypasses React entirely — it is pushed to
 * a Reanimated shared value by the provider.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import { Buffer } from 'buffer';

import {
  CLIP_SAMPLES,
  SAMPLE_RATE,
  computeRMS,
  extractMelSpectrogramAsync,
} from './audio/melSpectrogram';
import {
  DEFAULT_SETTINGS,
  SOUND_DISPLAY_NAMES,
  SOUND_LABELS,
  SOUND_THREAT,
  saveDetectionEvent,
  type AppSettings,
  type SoundLabel,
  type ThreatLevel,
} from './storage';

/** Flip to true to restore verbose pipeline diagnostics. */
const DEBUG = false;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log('[SoundGuard]', ...args);
};

// ─── Capture configuration ───────────────────────────────────────────────────

/** 16 kHz is the one sample rate every Android device is guaranteed to support. */
const CAPTURE_RATE = 16000;
/** MediaRecorder.AudioSource.VOICE_RECOGNITION — no AGC, no noise suppression. */
const AUDIO_SOURCE = 6;
/** ~256 ms per chunk at 16 kHz. */
const CAPTURE_BUFFER = 4096;

// ─── ONNX configuration ──────────────────────────────────────────────────────

const ONNX_INPUT_NAME = 'serving_default_input_layer:0';
const ONNX_OUTPUT_NAME = 'StatefulPartitionedCall:1_0';
const ONNX_INPUT_DIMS = [1, 128, 128, 1];

// ─── Detection tuning ────────────────────────────────────────────────────────

/**
 * Sensitivity profile, indexed 0–4 for levels 1–5.
 *
 * windowGate  multiplier on the window RMS floor (0.005)
 * confidence  softmax floor below which the prediction is discarded
 * hopSeconds  how often a fresh 3 s window is analysed — this is the dominant
 *             term in end-to-end detection latency
 */
const SENSITIVITY_PROFILE = [
  { windowGate: 2.0, confidence: 0.62, hopSeconds: 1.5 },
  { windowGate: 1.5, confidence: 0.58, hopSeconds: 1.25 },
  { windowGate: 1.0, confidence: 0.52, hopSeconds: 1.0 },
  { windowGate: 0.6, confidence: 0.46, hopSeconds: 0.8 },
  { windowGate: 0.3, confidence: 0.4, hopSeconds: 0.6 },
] as const;

const WINDOW_RMS_BASE = 0.005;

/** A detection stays on screen this long after its last confirming window. */
const DETECTION_HOLD_MS = 5000;
/** How long a dismissed sound class stays suppressed. */
const DISMISS_SUPPRESS_MS = 25000;
/** Minimum gap between history entries for the same class. */
const HISTORY_DEDUPE_MS = 8000;
/** Safety valve for a wedged analysis (see the watchdog in `appendToRing`). */
const ANALYSIS_TIMEOUT_MS = 15000;

// ─── Public types ────────────────────────────────────────────────────────────

export type EngineStatus = 'idle' | 'starting' | 'listening' | 'error';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PermissionStatus = 'unknown' | 'granted' | 'denied';

export type Detection = {
  /** Stable while the same class keeps being detected — prevents card remounts. */
  id: string;
  label: SoundLabel;
  name: string;
  confidence: number;
  threat: ThreatLevel;
  /** When this class was first detected in the current run. */
  firstSeen: number;
  /** When it was last confirmed. */
  lastSeen: number;
  simulated: boolean;
};

export type EngineState = {
  status: EngineStatus;
  modelStatus: ModelStatus;
  permission: PermissionStatus;
  /** The detection currently shown to the user, or null. */
  detection: Detection | null;
  /** True while a window is being classified. */
  analyzing: boolean;
  /** Milliseconds of uninterrupted critical-level audio. */
  criticalHoldMs: number;
  /** Wall-clock cost of the last full analysis, for the diagnostics row. */
  lastLatencyMs: number;
  windowsAnalyzed: number;
  /** Classes currently suppressed because the user dismissed them. */
  dismissed: SoundLabel[];
  error: string | null;
};

export type EngineEvent =
  | { type: 'detection'; detection: Detection }
  | { type: 'dismissed'; label: SoundLabel }
  | { type: 'reset' }
  | { type: 'stopped' };

/** Stable empty array so "nothing dismissed" never churns object identity. */
const NO_LABELS: SoundLabel[] = [];

const INITIAL_STATE: EngineState = {
  status: 'idle',
  modelStatus: 'idle',
  permission: 'unknown',
  detection: null,
  analyzing: false,
  criticalHoldMs: 0,
  lastLatencyMs: 0,
  windowsAnalyzed: 0,
  dismissed: NO_LABELS,
  error: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Prompt for RECORD_AUDIO. Exported so onboarding can ask before first use. */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone access',
        message:
          'SoundGuard listens to your surroundings on-device to recognise important sounds. Audio never leaves your phone.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function vibrate(threat: ThreatLevel) {
  if (Platform.OS === 'web') return;
  try {
    if (threat === 'critical') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, 180);
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, 360);
    } else if (threat === 'warning') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    /* Haptics are decorative; never let them break detection. */
  }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

class SoundEngine {
  // ── Reactive state ──
  private state: EngineState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: EngineEvent) => void>();

  /** Level meter sink. Wired to a Reanimated shared value — bypasses React. */
  onLevel: ((level: number) => void) | null = null;

  // ── Settings (hot-swappable; read fresh on every window) ──
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  // ── Audio ──
  private ring = new Float32Array(CLIP_SAMPLES);
  private writeIdx = 0;
  private filled = 0;
  private samplesSinceAnalysis = 0;
  private resampleScratch = new Float32Array(16384);
  private analysisBuf = new Float32Array(CLIP_SAMPLES);
  private audioSub: { remove: () => void } | null = null;

  // ── Model ──
  private session: InferenceSession | null = null;
  private modelPromise: Promise<InferenceSession | null> | null = null;

  // ── Scheduling ──
  private running = false;
  /**
   * Single-flight mutex for the analysis pipeline. Only `analyze()` may clear
   * it — start/stop deliberately leave it alone, so a stop issued mid-analysis
   * cannot let a second extraction begin against the shared DSP scratch
   * buffers. The in-flight run notices the session change and bails out.
   */
  private analyzing = false;
  private analysisStartedAt = 0;
  /** Incremented on every start/stop so stale async work can be discarded. */
  private sessionId = 0;

  // ── Detection bookkeeping ──
  private suppressUntil = new Map<SoundLabel, number>();
  private lastLoggedAt = new Map<SoundLabel, number>();
  /** Join key of the published `dismissed` array, so we only publish real changes. */
  private dismissedKey = '';

  // ───────────────────────────────────────────────────────────────────────────
  // Store contract
  // ───────────────────────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): EngineState => this.state;

  onEvent = (listener: (e: EngineEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  };

  private emit(event: EngineEvent) {
    this.eventListeners.forEach((l) => {
      try {
        l(event);
      } catch {
        /* one bad subscriber must not stop the others */
      }
    });
  }

  /**
   * Immutable, change-gated publish. Identical values do not notify, so the
   * steady-state listening loop schedules zero renders.
   */
  private patch(next: Partial<EngineState>) {
    let changed = false;
    for (const key of Object.keys(next) as (keyof EngineState)[]) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* ignore */
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Settings
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Replace the live settings. Every value is consulted at the start of the
   * next window, so a change made on the Settings screen takes effect within
   * one hop — no restart, no remount.
   */
  setSettings(settings: AppSettings) {
    this.settings = settings;

    // A newly muted class must vanish from the UI immediately, not on the next
    // window boundary.
    const current = this.state.detection;
    if (current && settings.mutedSounds.includes(current.label)) {
      this.patch({ detection: null, criticalHoldMs: 0 });
    }
  }

  /** Sensitivity after the optional night-time boost. */
  private effectiveSensitivity(): number {
    let level = this.settings.sensitivity;
    if (this.settings.nightMode) {
      const hour = new Date().getHours();
      if (hour >= 21 || hour < 6) level += 1;
    }
    return Math.min(5, Math.max(1, level));
  }

  private profile() {
    const idx = this.effectiveSensitivity() - 1;
    return SENSITIVITY_PROFILE[idx] ?? SENSITIVITY_PROFILE[2]!;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Model
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Load the ONNX session. Safe to call repeatedly and concurrently — the
   * in-flight promise is shared.
   */
  loadModel(): Promise<InferenceSession | null> {
    if (this.session) return Promise.resolve(this.session);
    if (this.modelPromise) return this.modelPromise;

    this.patch({ modelStatus: 'loading' });

    this.modelPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const modelModule = require('../assets/model/sound_model.onnx');
        const asset = Asset.fromModule(modelModule);

        if (!asset.localUri) await asset.downloadAsync();
        if (!asset.localUri) throw new Error('expo-asset returned a null localUri');

        const destUri = `${FileSystem.documentDirectory}sound_model.onnx`;
        const [cached, bundled] = await Promise.all([
          FileSystem.getInfoAsync(destUri),
          FileSystem.getInfoAsync(asset.localUri),
        ]);

        // Freshness check by byte size: an O(1) stat beats hashing a 10 MB model
        // on every cold start. Distinct sentinels so "missing" never compares
        // equal to "present but unmeasurable".
        const cachedSize = cached.exists ? ((cached as { size?: number }).size ?? -1) : -1;
        const bundledSize = bundled.exists ? ((bundled as { size?: number }).size ?? -2) : -2;

        if (!cached.exists || cachedSize !== bundledSize) {
          await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
          log('model copied', bundledSize, 'bytes');
        }

        const session = await InferenceSession.create(destUri.replace(/^file:\/\//, ''), {
          executionProviders: ['cpu'],
        });

        this.session = session;
        this.patch({ modelStatus: 'ready', error: null });
        log('ONNX session ready');
        return session;
      } catch (err) {
        log('model load failed', err);
        this.modelPromise = null; // allow a retry
        this.patch({
          modelStatus: 'error',
          error: 'The recognition model could not be loaded. Reopen the app to retry.',
        });
        return null;
      }
    })();

    return this.modelPromise;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running || this.state.status === 'starting') return;

    this.patch({ status: 'starting', error: null });

    const granted = await requestMicrophonePermission();
    if (!granted) {
      this.patch({
        status: 'idle',
        permission: 'denied',
        error: 'Microphone access is required to listen. Enable it in system settings.',
      });
      return;
    }
    this.patch({ permission: 'granted' });

    // Kick the model load but do not block the transition to "listening":
    // capture can begin while the session finishes opening.
    void this.loadModel();

    this.sessionId += 1;
    this.running = true;
    this.resetBuffers();
    this.suppressUntil.clear();
    this.lastLoggedAt.clear();
    this.dismissedKey = '';

    this.patch({
      status: 'listening',
      detection: null,
      criticalHoldMs: 0,
      windowsAnalyzed: 0,
      dismissed: NO_LABELS,
      analyzing: false,
      error: null,
    });

    try {
      LiveAudioStream.init({
        sampleRate: CAPTURE_RATE,
        channels: 1,
        bitsPerSample: 16,
        audioSource: AUDIO_SOURCE,
        bufferSize: CAPTURE_BUFFER,
        // Required by the package's typings (inherited from react-native-audio-record)
        // but ignored by the Android module, which never reads the key. We stream
        // PCM through the JS bridge and never write a file.
        wavFile: '',
      });

      // `AudioRecord.on` clears previous listeners internally, so repeated
      // start/stop cycles cannot accumulate duplicate handlers. It does return
      // the EventEmitter subscription, even though the typings say `void`.
      this.audioSub = LiveAudioStream.on('data', this.handleChunk) as unknown as {
        remove: () => void;
      } | null;
      LiveAudioStream.start();
      log('capture started');
    } catch (err) {
      log('capture failed', err);
      this.running = false;
      this.patch({
        status: 'error',
        error: 'Could not open the microphone. Close other recording apps and try again.',
      });
    }
  }

  stop(): void {
    if (!this.running) {
      // Still clear any lingering detection so the UI is consistent.
      this.patch({ status: 'idle', detection: null, analyzing: false, criticalHoldMs: 0 });
      return;
    }

    this.sessionId += 1;
    this.running = false;

    try {
      this.audioSub?.remove();
    } catch {
      /* ignore */
    }
    this.audioSub = null;

    try {
      LiveAudioStream.stop();
    } catch {
      /* ignore */
    }

    this.resetBuffers();
    this.suppressUntil.clear();
    this.dismissedKey = '';
    this.onLevel?.(0);

    this.patch({
      status: 'idle',
      detection: null,
      analyzing: false,
      criticalHoldMs: 0,
      dismissed: NO_LABELS,
    });
    this.emit({ type: 'stopped' });
    log('capture stopped');
  }

  async toggle(): Promise<void> {
    if (this.running) this.stop();
    else await this.start();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Interactive controls
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Dismiss the active detection.
   *
   * Runs entirely synchronously so the card disappears in the same frame as the
   * tap. The class is suppressed for a cool-off period and the audio buffer is
   * flushed, otherwise the sound still sitting in the 3 s window would be
   * re-reported on the very next hop.
   */
  dismiss(): void {
    const current = this.state.detection;
    if (!current) return;

    this.suppressUntil.set(current.label, Date.now() + DISMISS_SUPPRESS_MS);
    this.resetBuffers();

    this.patch({ detection: null, criticalHoldMs: 0 });
    this.syncDismissed();

    if (this.settings.hapticFeedback) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        /* ignore */
      }
    }

    this.emit({ type: 'dismissed', label: current.label });
  }

  /** Undo the most recent dismissal(s) — clears every active suppression. */
  undoDismiss(): void {
    if (this.suppressUntil.size === 0) return;
    this.suppressUntil.clear();
    this.dismissedKey = '';
    this.patch({ dismissed: NO_LABELS });
  }

  /**
   * Reset the listening state: flush the audio buffer, clear the current
   * detection, drop suppressions and restart the critical hold. Capture keeps
   * running, so there is no audible or visual gap.
   */
  reset(): void {
    this.resetBuffers();
    this.suppressUntil.clear();
    this.lastLoggedAt.clear();
    this.dismissedKey = '';
    this.onLevel?.(0);

    this.patch({
      detection: null,
      criticalHoldMs: 0,
      dismissed: NO_LABELS,
      windowsAnalyzed: 0,
      error: null,
    });

    if (this.settings.hapticFeedback) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        /* ignore */
      }
    }

    this.emit({ type: 'reset' });
  }

  /** Publish a detection as if it had come from the microphone (demo / viva). */
  simulate(label: SoundLabel): void {
    const now = Date.now();
    const detection: Detection = {
      id: `sim-${label}-${now}`,
      label,
      name: SOUND_DISPLAY_NAMES[label],
      confidence: 0.93,
      threat: SOUND_THREAT[label],
      firstSeen: now,
      lastSeen: now,
      simulated: true,
    };

    this.patch({
      detection,
      criticalHoldMs:
        detection.threat === 'critical'
          ? Math.max(this.settings.criticalHoldSeconds * 1000, 1)
          : 0,
    });

    if (this.settings.hapticFeedback) vibrate(detection.threat);
    this.emit({ type: 'detection', detection });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Audio capture
  // ───────────────────────────────────────────────────────────────────────────

  private resetBuffers() {
    this.ring.fill(0);
    this.writeIdx = 0;
    this.filled = 0;
    this.samplesSinceAnalysis = 0;
  }

  /**
   * Recompute the suppression list and publish it only if it actually changed.
   * The array identity would otherwise churn on every window and schedule a
   * render for nothing.
   */
  private syncDismissed() {
    const now = Date.now();
    const list: SoundLabel[] = [];
    for (const label of SOUND_LABELS) {
      const until = this.suppressUntil.get(label);
      if (until === undefined) continue;
      if (until > now) list.push(label);
      else this.suppressUntil.delete(label);
    }

    const key = list.join(',');
    if (key === this.dismissedKey) return;
    this.dismissedKey = key;
    this.patch({ dismissed: list });
  }

  /**
   * Per-chunk handler. Deliberately synchronous and short: decode, resample,
   * append, and hand off. The expensive work is scheduled, never inlined here.
   */
  private handleChunk = (base64Chunk: string): void => {
    if (!this.running) return;

    try {
      const bytes = Buffer.from(base64Chunk, 'base64');
      const sampleCount = bytes.length >> 1;
      if (sampleCount === 0) return;

      // Grow scratch if the native layer ever hands us a larger chunk.
      const needed = Math.ceil((sampleCount * SAMPLE_RATE) / CAPTURE_RATE) + 2;
      if (this.resampleScratch.length < needed) {
        this.resampleScratch = new Float32Array(needed * 2);
      }

      // Decode signed little-endian Int16 by hand. Constructing an Int16Array
      // view over the Buffer would throw whenever the pooled byteOffset is odd.
      const src = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const lo = bytes[i * 2] as number;
        const hi = bytes[i * 2 + 1] as number;
        let v = (hi << 8) | lo;
        if (v >= 0x8000) v -= 0x10000;
        src[i] = v / 32768;
      }

      const level = computeRMS(src);
      // Perceptual curve: quiet rooms should still show life on the meter.
      this.onLevel?.(Math.min(1, Math.sqrt(level * 7)));

      const outLen = this.resample(src, sampleCount);
      this.appendToRing(this.resampleScratch, outLen);
    } catch (err) {
      log('chunk error', err);
    }
  };

  /** Linear resample CAPTURE_RATE → SAMPLE_RATE into `resampleScratch`. */
  private resample(src: Float32Array, srcLen: number): number {
    const ratio = SAMPLE_RATE / CAPTURE_RATE;
    const outLen = Math.floor(srcLen * ratio);
    const out = this.resampleScratch;
    const last = srcLen - 1;

    for (let i = 0; i < outLen; i++) {
      const pos = i / ratio;
      const lo = Math.floor(pos);
      const hi = lo < last ? lo + 1 : last;
      const frac = pos - lo;
      out[i] = (src[lo] as number) * (1 - frac) + (src[hi] as number) * frac;
    }
    return outLen;
  }

  /** Append into the circular buffer and trigger analysis on the hop boundary. */
  private appendToRing(data: Float32Array, length: number) {
    const ring = this.ring;
    const cap = CLIP_SAMPLES;
    let idx = this.writeIdx;

    for (let i = 0; i < length; i++) {
      ring[idx] = data[i] as number;
      idx += 1;
      if (idx === cap) idx = 0;
    }

    this.writeIdx = idx;
    this.filled = Math.min(cap, this.filled + length);
    this.samplesSinceAnalysis += length;

    // Watchdog: if a native call ever fails to settle, release the mutex rather
    // than silently going deaf for the rest of the session.
    if (this.analyzing && Date.now() - this.analysisStartedAt > ANALYSIS_TIMEOUT_MS) {
      log('analysis watchdog fired — releasing the mutex');
      this.analyzing = false;
    }

    const hopSamples = Math.floor(this.profile().hopSeconds * SAMPLE_RATE);
    if (
      !this.analyzing &&
      this.filled >= cap &&
      this.samplesSinceAnalysis >= hopSamples
    ) {
      this.samplesSinceAnalysis = 0;
      // Detach from the audio callback so the handler returns immediately.
      void this.analyze();
    }
  }

  /** Unwrap the circular buffer into `analysisBuf`, oldest sample first. */
  private linearise() {
    const cap = CLIP_SAMPLES;
    const start = this.writeIdx; // oldest sample lives at the write cursor
    const tail = cap - start;
    this.analysisBuf.set(this.ring.subarray(start, cap), 0);
    if (tail < cap) this.analysisBuf.set(this.ring.subarray(0, start), tail);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Analysis
  // ───────────────────────────────────────────────────────────────────────────

  private async analyze(): Promise<void> {
    if (this.analyzing || !this.running) return;

    const session = this.session;
    if (!session) return; // model still opening; the next hop will retry

    const mySession = this.sessionId;
    const startedAt = Date.now();
    this.analyzing = true;
    this.analysisStartedAt = startedAt;

    try {
      this.linearise();

      // ── Window-level silence gate ──
      const profile = this.profile();
      const gate = WINDOW_RMS_BASE * profile.windowGate;
      const rms = computeRMS(this.analysisBuf);

      if (rms < gate) {
        this.expireDetection();
        return;
      }

      this.patch({ analyzing: true });

      const features = await extractMelSpectrogramAsync(this.analysisBuf);
      if (mySession !== this.sessionId || !this.running) return;

      const result = await this.infer(session, features);
      if (mySession !== this.sessionId || !this.running) return;

      this.patch({
        windowsAnalyzed: this.state.windowsAnalyzed + 1,
        lastLatencyMs: Date.now() - startedAt,
      });

      if (!result || result.confidence < profile.confidence) {
        this.expireDetection();
        return;
      }

      this.publish(result.label, result.confidence, profile.hopSeconds * 1000);
    } catch (err) {
      log('analysis error', err);
      this.expireDetection();
    } finally {
      this.analyzing = false;
      if (this.state.analyzing) this.patch({ analyzing: false });
    }
  }

  private async infer(
    session: InferenceSession,
    features: Float32Array,
  ): Promise<{ label: SoundLabel; confidence: number } | null> {
    try {
      const input = new Tensor('float32', features, ONNX_INPUT_DIMS);
      const results = await session.run({ [ONNX_INPUT_NAME]: input });

      let output = results[ONNX_OUTPUT_NAME];
      if (!output) {
        const firstKey = Object.keys(results)[0];
        if (!firstKey) return null;
        output = results[firstKey];
      }
      if (!output) return null;

      const probs = output.data as Float32Array;
      if (!probs || probs.length === 0) return null;

      let bestIdx = 0;
      let best = probs[0] as number;
      for (let i = 1; i < probs.length; i++) {
        const p = probs[i] as number;
        if (p > best) {
          best = p;
          bestIdx = i;
        }
      }

      const label = SOUND_LABELS[bestIdx];
      if (!label) return null;

      if (DEBUG) {
        log(
          'probs',
          SOUND_LABELS.map((l, i) => `${l}=${(probs[i] ?? 0).toFixed(3)}`).join(' '),
        );
      }

      return { label, confidence: best };
    } catch (err) {
      log('inference error', err);
      return null;
    }
  }

  /**
   * Accept a classified window and surface it, applying the mute list, the
   * dismissal cool-off and the on-screen hold.
   */
  private publish(label: SoundLabel, confidence: number, hopMs: number) {
    const now = Date.now();

    if (this.settings.mutedSounds.includes(label)) {
      this.expireDetection();
      return;
    }

    const suppressedUntil = this.suppressUntil.get(label);
    if (suppressedUntil && suppressedUntil > now) {
      this.expireDetection();
      return;
    }
    if (suppressedUntil) {
      this.suppressUntil.delete(label);
      this.syncDismissed();
    }

    const threat = SOUND_THREAT[label];
    const previous = this.state.detection;
    const isSameClass = previous?.label === label && !previous.simulated;

    const detection: Detection = {
      // Keeping the id stable across confirming windows means the detection
      // card updates in place instead of remounting its animations.
      id: isSameClass ? previous.id : `${label}-${now}`,
      label,
      name: SOUND_DISPLAY_NAMES[label],
      confidence,
      threat,
      firstSeen: isSameClass ? previous.firstSeen : now,
      lastSeen: now,
      simulated: false,
    };

    const criticalHoldMs =
      threat === 'critical' ? this.state.criticalHoldMs + hopMs : 0;

    this.patch({ detection, criticalHoldMs });

    if (!isSameClass) {
      if (this.settings.hapticFeedback) vibrate(threat);
      this.emit({ type: 'detection', detection });
    }

    this.persist(detection);
  }

  /** Clear the on-screen detection once its hold window has elapsed. */
  private expireDetection() {
    const current = this.state.detection;
    if (!current) {
      if (this.state.criticalHoldMs !== 0) this.patch({ criticalHoldMs: 0 });
      return;
    }
    if (Date.now() - current.lastSeen >= DETECTION_HOLD_MS) {
      this.patch({ detection: null, criticalHoldMs: 0 });
    } else if (this.state.criticalHoldMs !== 0) {
      // The streak is broken even though the card is still on screen.
      this.patch({ criticalHoldMs: 0 });
    }
  }

  /** Write to history, rate-limited per class. Never blocks the pipeline. */
  private persist(detection: Detection) {
    if (detection.threat === 'safe' && !this.settings.logSafeEvents) return;

    const last = this.lastLoggedAt.get(detection.label) ?? 0;
    if (detection.lastSeen - last < HISTORY_DEDUPE_MS) return;
    this.lastLoggedAt.set(detection.label, detection.lastSeen);

    void saveDetectionEvent({
      id: `${detection.lastSeen}-${Math.random().toString(36).slice(2, 8)}`,
      soundName: detection.name,
      rawLabel: detection.label,
      confidence: detection.confidence,
      threatLevel: detection.threat,
      timestamp: detection.lastSeen,
      simulated: detection.simulated,
    });
  }
}

/**
 * Module singleton. A single instance survives Fast Refresh, so audio
 * subscriptions and the ONNX session are never duplicated during development.
 */
export const soundEngine = new SoundEngine();
