import React from 'react';
import { StyleSheet, View, Text, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/Colors';

type SettingItem = { icon: keyof typeof Ionicons.glyphMap; label: string; subtitle?: string; type: 'toggle' | 'link'; value?: boolean };

const SETTINGS: { title: string; items: SettingItem[] }[] = [
  {
    title: 'Detection',
    items: [
      { icon: 'ear-outline', label: 'Sound Detection', subtitle: 'Continuously listen for sounds', type: 'toggle', value: true },
      { icon: 'pulse-outline', label: 'Vibration Alerts', subtitle: 'Haptic feedback on detection', type: 'toggle', value: true },
      { icon: 'flash-outline', label: 'Flash Alerts', subtitle: 'Use camera flash for alerts', type: 'toggle', value: false },
    ],
  },
  {
    title: 'Emergency',
    items: [
      { icon: 'call-outline', label: 'SOS Auto-Call', subtitle: 'Call emergency services on SOS', type: 'toggle', value: false },
      { icon: 'location-outline', label: 'Share Location', subtitle: 'Include GPS in SOS alerts', type: 'toggle', value: true },
      { icon: 'people-outline', label: 'Manage Circle', type: 'link' },
    ],
  },
  {
    title: 'App',
    items: [
      { icon: 'language-outline', label: 'Language', type: 'link' },
      { icon: 'help-circle-outline', label: 'Help & Support', type: 'link' },
      { icon: 'document-text-outline', label: 'Privacy Policy', type: 'link' },
      { icon: 'information-circle-outline', label: 'About SoundGuard', type: 'link' },
    ],
  },
];

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {SETTINGS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, idx) => (
                <TouchableOpacity key={item.label} style={[styles.row, idx < section.items.length - 1 && styles.rowBorder]} activeOpacity={0.7}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={item.icon} size={22} color={theme.colors.accent} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.subtitle && <Text style={styles.rowSub}>{item.subtitle}</Text>}
                  </View>
                  {item.type === 'toggle' ? (
                    <Switch value={item.value} trackColor={{ false: theme.colors.border, true: theme.colors.accentMuted }} thumbColor={item.value ? theme.colors.accent : theme.colors.textTertiary} />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <Text style={styles.version}>SoundGuard v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 48 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, marginLeft: 14 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  rowSub: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2 },
  version: { textAlign: 'center', fontSize: 13, color: theme.colors.textTertiary, marginTop: 32 },
});
