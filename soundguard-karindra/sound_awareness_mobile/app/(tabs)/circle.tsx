import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Switch,
  Alert, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '@/constants/Colors';
import { getContacts, saveContact, deleteContact, getSettings, saveSetting } from '@/utils/storage';
import type { EmergencyContact } from '@/utils/storage';

// ─── Avatar color palette ────────────────────────────────────────
const COLORS = ['#FF6B8A', '#6B8AFF', '#FFB020', '#4ADE80', '#A78BFA', '#F472B6', '#38BDF8'];
function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}
function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Contact Card ────────────────────────────────────────────────
function ContactCard({ contact, onRemove }: { contact: EmergencyContact; onRemove: () => void }) {
  const color = getAvatarColor(contact.name);
  const initials = getInitials(contact.name);
  return (
    <View style={styles.contactCard}>
      <View style={[styles.avatar, { backgroundColor: color + '20' }]}>
        <Text style={[styles.avatarText, { color }]}>{initials}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{contact.name}</Text>
        <View style={styles.contactMetaRow}>
          <Ionicons name="call-outline" size={13} color={theme.colors.textTertiary} />
          <Text style={styles.contactPhone}>{contact.phone}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.removeBtn} onPress={onRemove} activeOpacity={0.6}>
        <Ionicons name="trash-outline" size={18} color={theme.colors.urgent} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Add Contact Modal ───────────────────────────────────────────
function AddContactModal({ visible, onClose, onSave }: {
  visible: boolean;
  onClose: () => void;
  onSave: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimName = name.trim();
    const trimPhone = phone.trim();
    if (!trimName) return Alert.alert('Missing Name', 'Please enter a contact name.');
    if (!trimPhone) return Alert.alert('Missing Phone', 'Please enter a phone number.');
    setSaving(true);
    await onSave(trimName, trimPhone);
    setSaving(false);
    setName('');
    setPhone('');
  };

  const handleClose = () => {
    setName('');
    setPhone('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalHandleBar} />
            <Text style={styles.modalTitle}>Add Emergency Contact</Text>
            <Text style={styles.modalDesc}>This person will receive SOS alerts with your location.</Text>
          </View>

          {/* Name field */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={18} color={theme.colors.textTertiary} />
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Sarah Johnson"
                placeholderTextColor={theme.colors.textTertiary}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Phone field */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={18} color={theme.colors.textTertiary} />
              <TextInput
                style={styles.textInput}
                placeholder="e.g. +1 555 234 5678"
                placeholderTextColor={theme.colors.textTertiary}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Buttons */}
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.7} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={theme.colors.background} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color={theme.colors.background} />
                  <Text style={styles.saveBtnText}>Save Contact</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Circle Screen ──────────────────────────────────────────
export default function CircleScreen() {
  const insets = useSafeAreaInsets();
  const [autoShareLocation, setAutoShareLocation] = useState(true);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load contacts and settings on focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        const [stored, settings] = await Promise.all([getContacts(), getSettings()]);
        setContacts(stored);
        setAutoShareLocation(settings.shareLocation);
        setLoading(false);
      })();
    }, [])
  );

  const handleToggleLocation = async (val: boolean) => {
    setAutoShareLocation(val);
    await saveSetting('shareLocation', val);
  };

  const handleRemove = (id: string) => {
    Alert.alert('Remove Contact', 'Remove this contact from your Safety Circle?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await deleteContact(id);
          setContacts((prev) => prev.filter((c) => c.id !== id));
        },
      },
    ]);
  };

  const handleSaveContact = async (name: string, phone: string) => {
    const newContact: EmergencyContact = {
      id: Date.now().toString(),
      name,
      phone,
      createdAt: Date.now(),
    };
    await saveContact(newContact);
    setContacts((prev) => [...prev, newContact]);
    setModalVisible(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Safety Circle</Text>
          <Text style={styles.subtitle}>People who receive your SOS alerts</Text>
        </View>

        {/* Auto-share toggle */}
        <View style={styles.toggleCard}>
          <View style={styles.toggleIconBox}>
            <Ionicons name="location" size={22} color={autoShareLocation ? theme.colors.accent : theme.colors.textTertiary} />
          </View>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Auto-Share Location on SOS</Text>
            <Text style={styles.toggleDesc}>Include GPS coordinates in emergency alerts</Text>
          </View>
          <Switch
            value={autoShareLocation}
            onValueChange={handleToggleLocation}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentMuted }}
            thumbColor={autoShareLocation ? theme.colors.accent : theme.colors.textTertiary}
          />
        </View>

        {/* Add button */}
        <TouchableOpacity style={styles.addButton} activeOpacity={0.7} onPress={() => setModalVisible(true)}>
          <View style={styles.addIconCircle}>
            <Ionicons name="add" size={24} color={theme.colors.accent} />
          </View>
          <View style={styles.addTextGroup}>
            <Text style={styles.addTitle}>Add New Contact</Text>
            <Text style={styles.addDesc}>Invite someone to your Safety Circle</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
        </TouchableOpacity>

        {/* Section header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>EMERGENCY CONTACTS</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{contacts.length}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
          </View>
        ) : contacts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={theme.colors.textTertiary} />
            <Text style={styles.emptyText}>No contacts in your Safety Circle</Text>
            <Text style={styles.emptyDesc}>Tap "Add New Contact" to get started</Text>
          </View>
        ) : (
          contacts.map((c) => (
            <ContactCard key={c.id} contact={c} onRemove={() => handleRemove(c.id)} />
          ))
        )}

        {/* Info footer */}
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.accent} />
          <Text style={styles.infoText}>
            Your circle is notified instantly when you trigger an SOS. They receive your location, detected sound data, and a direct call option.
          </Text>
        </View>
      </ScrollView>

      <AddContactModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveContact}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { paddingHorizontal: 24 },

  header: { paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4 },

  toggleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginBottom: 12 },
  toggleIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  toggleInfo: { flex: 1, marginLeft: 14 },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  toggleDesc: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2 },

  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.accent + '33', borderStyle: 'dashed', padding: 16, marginBottom: 24 },
  addIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  addTextGroup: { flex: 1, marginLeft: 14 },
  addTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.accent },
  addDesc: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textTertiary, letterSpacing: 1 },
  countBadge: { backgroundColor: theme.colors.surfaceElevated, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.colors.border },
  countText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },

  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  contactInfo: { flex: 1, marginLeft: 14 },
  contactName: { fontSize: 17, fontWeight: '600', color: theme.colors.text },
  contactMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  contactPhone: { fontSize: 13, color: theme.colors.textTertiary },
  removeBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.urgent + '12', alignItems: 'center', justifyContent: 'center' },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary },
  emptyDesc: { fontSize: 14, color: theme.colors.textTertiary },

  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginTop: 16 },
  infoText: { flex: 1, fontSize: 13, color: theme.colors.textTertiary, lineHeight: 20 },

  // ── Modal ──
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCard: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, borderWidth: 1, borderColor: theme.colors.border },
  modalHeader: { alignItems: 'center', paddingTop: 12, paddingBottom: 20 },
  modalHandleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  modalDesc: { fontSize: 14, color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center' },

  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, gap: 10 },
  textInput: { flex: 1, height: 50, fontSize: 16, color: theme.colors.text },

  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.border },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary },
  saveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14, backgroundColor: theme.colors.accent },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: theme.colors.background },
});
