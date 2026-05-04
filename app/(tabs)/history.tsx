import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/Colors';

type HistoryEvent = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  time: string;
  level: 'info' | 'warning' | 'critical';
  decibels: number;
};

const SAMPLE_EVENTS: HistoryEvent[] = [
  { id: '1', icon: 'car-outline', label: 'Car Horn Detected', time: '2 min ago', level: 'warning', decibels: 78 },
  { id: '2', icon: 'notifications-outline', label: 'Doorbell Ring', time: '15 min ago', level: 'info', decibels: 62 },
  { id: '3', icon: 'flame-outline', label: 'Smoke Alarm', time: '1 hr ago', level: 'critical', decibels: 95 },
  { id: '4', icon: 'megaphone-outline', label: 'Siren Detected', time: '3 hr ago', level: 'critical', decibels: 90 },
  { id: '5', icon: 'musical-notes-outline', label: 'Music Detected', time: '5 hr ago', level: 'info', decibels: 55 },
];

const levelColors = { info: theme.colors.accent, warning: '#FFB020', critical: theme.colors.urgent };

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Detection History</Text>
        <Text style={styles.subtitle}>Recent sound events</Text>
      </View>
      <View style={styles.filterRow}>
        {(['All', 'Critical', 'Warning', 'Info'] as const).map((label, idx) => (
          <TouchableOpacity key={label} style={[styles.chip, idx === 0 && styles.chipActive]} activeOpacity={0.7}>
            <Text style={[styles.chipText, idx === 0 && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {SAMPLE_EVENTS.map((event) => (
          <TouchableOpacity key={event.id} style={styles.eventCard} activeOpacity={0.7}>
            <View style={[styles.levelBar, { backgroundColor: levelColors[event.level] }]} />
            <View style={styles.eventIconBox}>
              <Ionicons name={event.icon} size={24} color={levelColors[event.level]} />
            </View>
            <View style={styles.eventInfo}>
              <Text style={styles.eventLabel}>{event.label}</Text>
              <Text style={styles.eventTime}>{event.time}</Text>
            </View>
            <View style={styles.eventMeta}>
              <Text style={[styles.eventDb, { color: levelColors[event.level] }]}>{event.decibels} dB</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
            </View>
          </TouchableOpacity>
        ))}
        <View style={styles.footer}>
          <Ionicons name="time-outline" size={20} color={theme.colors.textTertiary} />
          <Text style={styles.footerText}>Events are auto-logged when sounds are detected</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: theme.colors.textSecondary, marginTop: 4 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 16, gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  chipText: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  chipTextActive: { color: theme.colors.black },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 48 },
  eventCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  levelBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  eventIconBox: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  eventInfo: { flex: 1, marginLeft: 16 },
  eventLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  eventTime: { fontSize: 14, color: theme.colors.textTertiary, marginTop: 2 },
  eventMeta: { alignItems: 'flex-end', gap: 4 },
  eventDb: { fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 32 },
  footerText: { fontSize: 14, color: theme.colors.textTertiary },
});
