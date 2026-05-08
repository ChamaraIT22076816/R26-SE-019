import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/Colors';

type Contact = {
  id: string;
  name: string;
  initials: string;
  role: string;
  phone: string;
  color: string;
  avatarBg: string;
};

const CONTACTS: Contact[] = [
  { id: '1', name: 'Sarah Johnson', initials: 'SJ', role: 'Mother', phone: '+1 (555) 234-5678', color: '#FF6B8A', avatarBg: 'rgba(255,107,138,0.15)' },
  { id: '2', name: 'Dr. Anil Patel', initials: 'AP', role: 'Doctor', phone: '+1 (555) 891-2345', color: '#6B8AFF', avatarBg: 'rgba(107,138,255,0.15)' },
  { id: '3', name: 'Mike Chen', initials: 'MC', role: 'Neighbor', phone: '+1 (555) 456-7890', color: '#FFB020', avatarBg: 'rgba(255,176,32,0.15)' },
];

const ROLE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Mother: 'heart-outline',
  Doctor: 'medkit-outline',
  Neighbor: 'home-outline',
};

function ContactCard({ contact, onRemove }: { contact: Contact; onRemove: () => void }) {
  return (
    <View style={styles.contactCard}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: contact.avatarBg }]}>
        <Text style={[styles.avatarText, { color: contact.color }]}>{contact.initials}</Text>
      </View>

      {/* Info */}
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{contact.name}</Text>
        <View style={styles.contactMetaRow}>
          <Ionicons name={ROLE_ICONS[contact.role] || 'person-outline'} size={13} color={contact.color} />
          <Text style={[styles.contactRole, { color: contact.color }]}>{contact.role}</Text>
          <View style={styles.contactDot} />
          <Text style={styles.contactPhone}>{contact.phone}</Text>
        </View>
      </View>

      {/* Remove */}
      <TouchableOpacity style={styles.removeBtn} onPress={onRemove} activeOpacity={0.6}>
        <Ionicons name="trash-outline" size={18} color={theme.colors.urgent} />
      </TouchableOpacity>
    </View>
  );
}

export default function CircleScreen() {
  const insets = useSafeAreaInsets();
  const [autoShareLocation, setAutoShareLocation] = useState(true);
  const [contacts, setContacts] = useState(CONTACTS);

  const handleRemove = (id: string) => {
    Alert.alert('Remove Contact', 'Are you sure you want to remove this contact from your Safety Circle?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setContacts((prev) => prev.filter((c) => c.id !== id)) },
    ]);
  };

  const handleAdd = () => {
    Alert.alert('Add Contact', 'Contact picker would open here in production.');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        {/* Header */}
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
            onValueChange={setAutoShareLocation}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentMuted }}
            thumbColor={autoShareLocation ? theme.colors.accent : theme.colors.textTertiary}
          />
        </View>

        {/* Add button */}
        <TouchableOpacity style={styles.addButton} activeOpacity={0.7} onPress={handleAdd}>
          <View style={styles.addIconCircle}>
            <Ionicons name="add" size={24} color={theme.colors.accent} />
          </View>
          <View style={styles.addTextGroup}>
            <Text style={styles.addTitle}>Add New Contact</Text>
            <Text style={styles.addDesc}>Invite someone to your Safety Circle</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
        </TouchableOpacity>

        {/* Contacts list */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>EMERGENCY CONTACTS</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{contacts.length}</Text>
          </View>
        </View>

        {contacts.map((c) => (
          <ContactCard key={c.id} contact={c} onRemove={() => handleRemove(c.id)} />
        ))}

        {contacts.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={theme.colors.textTertiary} />
            <Text style={styles.emptyText}>No contacts in your Safety Circle</Text>
            <Text style={styles.emptyDesc}>Tap "Add New Contact" to get started</Text>
          </View>
        )}

        {/* Info footer */}
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.accent} />
          <Text style={styles.infoText}>
            Your circle is notified instantly when you trigger an SOS. They receive your location, detected sound data, and a direct call option.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { paddingHorizontal: 24 },

  header: { paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4 },

  // Toggle card
  toggleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginBottom: 12 },
  toggleIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  toggleInfo: { flex: 1, marginLeft: 14 },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  toggleDesc: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2 },

  // Add button
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.accent + '33', borderStyle: 'dashed', padding: 16, marginBottom: 24 },
  addIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  addTextGroup: { flex: 1, marginLeft: 14 },
  addTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.accent },
  addDesc: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2 },

  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textTertiary, letterSpacing: 1 },
  countBadge: { backgroundColor: theme.colors.surfaceElevated, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.colors.border },
  countText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },

  // Contact card
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  contactInfo: { flex: 1, marginLeft: 14 },
  contactName: { fontSize: 17, fontWeight: '600', color: theme.colors.text },
  contactMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  contactRole: { fontSize: 13, fontWeight: '600' },
  contactDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.colors.textTertiary, opacity: 0.5 },
  contactPhone: { fontSize: 13, color: theme.colors.textTertiary },
  removeBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.urgent + '12', alignItems: 'center', justifyContent: 'center' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary },
  emptyDesc: { fontSize: 14, color: theme.colors.textTertiary },

  // Info footer
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginTop: 16 },
  infoText: { flex: 1, fontSize: 13, color: theme.colors.textTertiary, lineHeight: 20 },
});
