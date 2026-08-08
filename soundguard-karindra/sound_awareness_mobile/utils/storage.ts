/**
 * SoundGuard — Local Storage Utility
 * ────────────────────────────────────
 * Handles persistence of Emergency Contacts, Settings preferences,
 * and the Detection History log using @react-native-async-storage/async-storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Storage Keys ────────────────────────────────────────────────
const KEYS = {
  CONTACTS:      '@soundguard/emergency_contacts',
  SETTINGS:      '@soundguard/settings',
  DETECTION_LOG: '@soundguard/detection_log',
} as const;

/** Maximum number of detection events persisted (circular eviction of oldest). */
const MAX_DETECTION_LOG_SIZE = 200;

// ─── Types ───────────────────────────────────────────────────────
export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  createdAt: number;
};

export type AppSettings = {
  hapticFeedback: boolean;
  flashlight: boolean;
  backgroundListening: boolean;
  sensitivity: number;
  autoCall: boolean;
  shareLocation: boolean;
  nightMode: boolean;
};

/**
 * DetectionEvent — one record in the real-time detection history log.
 * Written by useSoundRecognition after every warning/critical detection.
 */
export type DetectionEvent = {
  /** Unique identifier (timestamp-random). */
  id: string;
  /** Human-readable label shown in the UI, e.g. "Car Horn". */
  soundName: string;
  /** Raw model label, e.g. "car_horn". */
  rawLabel: string;
  /** Softmax confidence in [0, 1]. */
  confidence: number;
  /** Classification bucket. */
  threatLevel: 'warning' | 'critical';
  /** Unix epoch milliseconds. */
  timestamp: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  hapticFeedback: true,
  flashlight: false,
  backgroundListening: true,
  sensitivity: 3,
  autoCall: false,
  shareLocation: true,
  nightMode: false,
};

// ─── Contacts CRUD ───────────────────────────────────────────────

export async function getContacts(): Promise<EmergencyContact[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CONTACTS);
    return raw ? JSON.parse(raw) : [];
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
  const filtered = contacts.filter((c) => c.id !== id);
  await AsyncStorage.setItem(KEYS.CONTACTS, JSON.stringify(filtered));
}

// ─── Settings ────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const settings = await getSettings();
  settings[key] = value;
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

export async function saveAllSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

// ─── Detection History Log ────────────────────────────────────────

/**
 * getDetectionLog
 * Returns all persisted detection events, newest first.
 */
export async function getDetectionLog(): Promise<DetectionEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.DETECTION_LOG);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * saveDetectionEvent
 * Prepends a new detection event to the log.
 * Trims the log to MAX_DETECTION_LOG_SIZE entries (oldest evicted first).
 */
export async function saveDetectionEvent(event: DetectionEvent): Promise<void> {
  try {
    const log = await getDetectionLog();
    // Prepend so newest is first; trim to capacity.
    const updated = [event, ...log].slice(0, MAX_DETECTION_LOG_SIZE);
    await AsyncStorage.setItem(KEYS.DETECTION_LOG, JSON.stringify(updated));
  } catch {
    // Non-fatal: history logging errors must never affect the live detection path.
  }
}

/**
 * clearDetectionLog
 * Removes all persisted detection events (used by History screen "Clear All" button).
 */
export async function clearDetectionLog(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.DETECTION_LOG);
}
