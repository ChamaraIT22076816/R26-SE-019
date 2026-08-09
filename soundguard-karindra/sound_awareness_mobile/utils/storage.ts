/**
 * SoundGuard — Persistence Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Emergency contacts, application settings and the detection history log,
 * backed by AsyncStorage.
 *
 * Settings are read once at boot by SettingsProvider and then held in memory —
 * no screen reads AsyncStorage on every render, and no consumer polls. Writes
 * are fire-and-forget from the provider, which owns the in-memory truth.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Storage keys ────────────────────────────────────────────────────────────
const KEYS = {
  CONTACTS: '@soundguard/emergency_contacts',
  SETTINGS: '@soundguard/settings',
  DETECTION_LOG: '@soundguard/detection_log',
} as const;

/** Maximum detection events retained (oldest evicted first). */
const MAX_DETECTION_LOG_SIZE = 300;

// ─── Sound taxonomy ──────────────────────────────────────────────────────────

/** Raw class labels emitted by the ONNX model, in output-index order. */
export const SOUND_LABELS = [
  'car_horn',
  'crying_baby',
  'dog',
  'door_wood_knock',
  'footsteps',
  'glass_breaking',
  'siren',
] as const;

export type SoundLabel = (typeof SOUND_LABELS)[number];
export type ThreatLevel = 'safe' | 'warning' | 'critical';

export const SOUND_DISPLAY_NAMES: Record<SoundLabel, string> = {
  car_horn: 'Car Horn',
  crying_baby: 'Crying Baby',
  dog: 'Dog Barking',
  door_wood_knock: 'Door Knock',
  footsteps: 'Footsteps',
  glass_breaking: 'Glass Breaking',
  siren: 'Emergency Siren',
};

export const SOUND_THREAT: Record<SoundLabel, ThreatLevel> = {
  car_horn: 'warning',
  crying_baby: 'warning',
  dog: 'safe',
  door_wood_knock: 'safe',
  footsteps: 'safe',
  glass_breaking: 'critical',
  siren: 'critical',
};

/** Ionicons glyph per class — shared by every surface that renders a sound. */
export const SOUND_ICONS: Record<SoundLabel, string> = {
  car_horn: 'car-outline',
  crying_baby: 'happy-outline',
  dog: 'paw-outline',
  door_wood_knock: 'hand-left-outline',
  footsteps: 'footsteps-outline',
  glass_breaking: 'alert-circle-outline',
  siren: 'medkit-outline',
};

export function isSoundLabel(v: string): v is SoundLabel {
  return (SOUND_LABELS as readonly string[]).includes(v);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  createdAt: number;
};

export type ThemeMode = 'system' | 'light' | 'dark';

export type AppSettings = {
  /** First-run flow completed. */
  onboardingComplete: boolean;

  // Appearance
  themeMode: ThemeMode;
  /** Disables all looping/decorative animation. Accessibility + battery. */
  reduceMotion: boolean;

  // Detection
  /** 1 (conservative) … 5 (aggressive). Drives gates, confidence floor, cadence. */
  sensitivity: number;
  /** Raise sensitivity one step between 21:00 and 06:00. */
  nightMode: boolean;
  /** Vibrate when a sound is recognised. */
  hapticFeedback: boolean;
  /** Full-screen visual flash on a critical detection. */
  visualFlash: boolean;
  /** Keep the microphone open when the app is backgrounded. */
  backgroundListening: boolean;
  /** Raw labels the engine must never surface. */
  mutedSounds: SoundLabel[];
  /** Write routine (safe) detections to history as well. */
  logSafeEvents: boolean;

  // Emergency
  /** Escalate to the SOS screen after sustained critical detection. */
  autoSos: boolean;
  /** Seconds of continuous critical audio required before escalation. */
  criticalHoldSeconds: number;
  /** Seconds of abort window on the SOS screen. */
  sosCountdown: number;
  /** Attach GPS coordinates to the outgoing SOS message. */
  shareLocation: boolean;
  /** Offer a direct dial to the first contact once the SOS is dispatched. */
  callFirstContact: boolean;
};

export type DetectionEvent = {
  id: string;
  soundName: string;
  rawLabel: string;
  confidence: number;
  threatLevel: ThreatLevel;
  timestamp: number;
  /** True when produced by the in-app demo trigger rather than the microphone. */
  simulated?: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingComplete: false,

  themeMode: 'system',
  reduceMotion: false,

  sensitivity: 3,
  nightMode: false,
  hapticFeedback: true,
  visualFlash: true,
  backgroundListening: true,
  mutedSounds: [],
  logSafeEvents: false,

  autoSos: true,
  criticalHoldSeconds: 6,
  sosCountdown: 10,
  shareLocation: true,
  callFirstContact: false,
};

// ─── Settings ────────────────────────────────────────────────────────────────

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

/**
 * Coerce an arbitrary persisted blob into a valid AppSettings object.
 *
 * This is deliberately total: every field is validated and clamped, and the
 * two renamed v1 keys (`flashlight` → `visualFlash`, `autoCall` → `autoSos`)
 * are migrated. A corrupt or partial record can therefore never crash a screen
 * or feed an out-of-range value into the detection engine.
 */
function normaliseSettings(raw: unknown): AppSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: string, fallback: boolean) =>
    typeof s[k] === 'boolean' ? (s[k] as boolean) : fallback;
  const num = (k: string, fallback: number, min: number, max: number) => {
    const v = s[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  };

  const themeMode = THEME_MODES.includes(s.themeMode as ThemeMode)
    ? (s.themeMode as ThemeMode)
    : DEFAULT_SETTINGS.themeMode;

  const muted = Array.isArray(s.mutedSounds)
    ? (s.mutedSounds.filter((v): v is SoundLabel => typeof v === 'string' && isSoundLabel(v)))
    : [];

  return {
    onboardingComplete: bool('onboardingComplete', DEFAULT_SETTINGS.onboardingComplete),

    themeMode,
    reduceMotion: bool('reduceMotion', DEFAULT_SETTINGS.reduceMotion),

    sensitivity: num('sensitivity', DEFAULT_SETTINGS.sensitivity, 1, 5),
    nightMode: bool('nightMode', DEFAULT_SETTINGS.nightMode),
    hapticFeedback: bool('hapticFeedback', DEFAULT_SETTINGS.hapticFeedback),
    // v1 key was `flashlight`.
    visualFlash: bool('visualFlash', bool('flashlight', DEFAULT_SETTINGS.visualFlash)),
    backgroundListening: bool('backgroundListening', DEFAULT_SETTINGS.backgroundListening),
    mutedSounds: muted,
    logSafeEvents: bool('logSafeEvents', DEFAULT_SETTINGS.logSafeEvents),

    // v1 key was `autoCall`.
    autoSos: bool('autoSos', bool('autoCall', DEFAULT_SETTINGS.autoSos)),
    criticalHoldSeconds: num('criticalHoldSeconds', DEFAULT_SETTINGS.criticalHoldSeconds, 2, 30),
    sosCountdown: num('sosCountdown', DEFAULT_SETTINGS.sosCountdown, 3, 60),
    shareLocation: bool('shareLocation', DEFAULT_SETTINGS.shareLocation),
    callFirstContact: bool('callFirstContact', DEFAULT_SETTINGS.callFirstContact),
  };
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return normaliseSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAllSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    /* Persistence failures must never break the running session. */
  }
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function getContacts(): Promise<EmergencyContact[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CONTACTS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveContact(contact: EmergencyContact): Promise<void> {
  const contacts = await getContacts();
  contacts.push(contact);
  await AsyncStorage.setItem(KEYS.CONTACTS, JSON.stringify(contacts));
}

export async function deleteContact(id: string): Promise<void> {
  const contacts = await getContacts();
  await AsyncStorage.setItem(
    KEYS.CONTACTS,
    JSON.stringify(contacts.filter((c) => c.id !== id)),
  );
}

// ─── Detection history ───────────────────────────────────────────────────────

export async function getDetectionLog(): Promise<DetectionEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.DETECTION_LOG);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDetectionEvent(event: DetectionEvent): Promise<void> {
  try {
    const log = await getDetectionLog();
    await AsyncStorage.setItem(
      KEYS.DETECTION_LOG,
      JSON.stringify([event, ...log].slice(0, MAX_DETECTION_LOG_SIZE)),
    );
  } catch {
    /* History is best-effort; never let it affect the live detection path. */
  }
}

export async function clearDetectionLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.DETECTION_LOG);
  } catch {
    /* no-op */
  }
}
