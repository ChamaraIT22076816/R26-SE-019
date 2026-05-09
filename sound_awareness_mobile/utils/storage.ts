/**
 * SoundGuard — Local Storage Utility
 * ──────────────────────────────────
 * Handles persistence of Emergency Contacts and Settings preferences
 * using @react-native-async-storage/async-storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Storage Keys ────────────────────────────────────────────────
const KEYS = {
  CONTACTS: '@soundguard/emergency_contacts',
  SETTINGS: '@soundguard/settings',
} as const;

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
