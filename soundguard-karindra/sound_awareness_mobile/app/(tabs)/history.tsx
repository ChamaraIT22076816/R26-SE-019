import React, { useState } from 'react';
import { StyleSheet, View, Text, SectionList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/Colors';

type ThreatLevel = 'low' | 'medium' | 'critical';
type DetectionEvent = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  soundName: string;
  timestamp: string;
  level: ThreatLevel;
  decibels: number;
  duration: string;
};

const LEVEL_CFG: Record<ThreatLevel, { color: string; bg: string; label: string }> = {
  low: { color: '#4DA6FF', bg: 'rgba(77,166,255,0.12)', label: 'Low' },
  medium: { color: '#FFB020', bg: 'rgba(255,176,32,0.12)', label: 'Medium' },
  critical: { color: '#FF3B5C', bg: 'rgba(255,59,92,0.12)', label: 'Critical' },
};

type FilterOption = 'All' | 'Critical' | 'Medium' | 'Low';
const FILTERS: FilterOption[] = ['All', 'Critical', 'Medium', 'Low'];

const SECTIONS = [
  {
    title: 'Today',
    data: [
      { id: '1', icon: 'car-outline' as const, soundName: 'Car Horn', timestamp: '10:15 AM', level: 'medium' as ThreatLevel, decibels: 78, duration: '3s' },
      { id: '2', icon: 'medical-outline' as const, soundName: 'Ambulance Siren', timestamp: '9:42 AM', level: 'critical' as ThreatLevel, decibels: 92, duration: '12s' },
      { id: '3', icon: 'footsteps-outline' as const, soundName: 'Running Footsteps', timestamp: '8:30 AM', level: 'low' as ThreatLevel, decibels: 52, duration: '6s' },
      { id: '4', icon: 'notifications-outline' as const, soundName: 'Doorbell Ring', timestamp: '7:15 AM', level: 'low' as ThreatLevel, decibels: 60, duration: '2s' },
    ],
  },
  {
    title: 'Yesterday',
    data: [
      { id: '5', icon: 'flame-outline' as const, soundName: 'Smoke Alarm', timestamp: '11:30 PM', level: 'critical' as ThreatLevel, decibels: 95, duration: '28s' },
      { id: '6', icon: 'megaphone-outline' as const, soundName: 'Emergency Broadcast', timestamp: '8:15 PM', level: 'critical' as ThreatLevel, decibels: 88, duration: '15s' },
      { id: '7', icon: 'rainy-outline' as const, soundName: 'Thunder Clap', timestamp: '6:20 PM', level: 'medium' as ThreatLevel, decibels: 76, duration: '4s' },
      { id: '8', icon: 'musical-notes-outline' as const, soundName: 'Street Music', timestamp: '3:45 PM', level: 'low' as ThreatLevel, decibels: 55, duration: '45s' },
      { id: '9', icon: 'construct-outline' as const, soundName: 'Construction Drill', timestamp: '10:05 AM', level: 'medium' as ThreatLevel, decibels: 82, duration: '18s' },
    ],
  },
  {
    title: 'May 7, 2026',
    data: [
      { id: '10', icon: 'warning-outline' as const, soundName: 'Glass Breaking', timestamp: '9:50 PM', level: 'critical' as ThreatLevel, decibels: 90, duration: '2s' },
      { id: '11', icon: 'bus-outline' as const, soundName: 'Bus Air Brake', timestamp: '5:30 PM', level: 'low' as ThreatLevel, decibels: 58, duration: '3s' },
      { id: '12', icon: 'paw-outline' as const, soundName: 'Dog Barking', timestamp: '2:10 PM', level: 'low' as ThreatLevel, decibels: 48, duration: '8s' },
    ],
  },
];

function EventCard({ event }: { event: DetectionEvent }) {
  const lc = LEVEL_CFG[event.level];
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7}>
      <View style={[styles.cardAccent, { backgroundColor: lc.color }]} />
      <View style={[styles.cardIcon, { backgroundColor: lc.bg }]}>
        <Ionicons name={event.icon} size={22} color={lc.color} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{event.soundName}</Text>
        <View style={styles.cardMetaRow}>
          <Ionicons name="time-outline" size={12} color={theme.colors.textTertiary} />
          <Text style={styles.cardMeta}>{event.timestamp}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.cardMeta}>{event.decibels} dB</Text>
          <View style={styles.metaDot} />
          <Text style={styles.cardMeta}>{event.duration}</Text>
        </View>
      </View>
      <View style={[styles.levelBadge, { backgroundColor: lc.bg, borderColor: lc.color + '44' }]}>
        <View style={[styles.levelDot, { backgroundColor: lc.color }]} />
        <Text style={[styles.levelText, { color: lc.color }]}>{lc.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<FilterOption>('All');

  const filteredSections = SECTIONS.map((s) => ({
    ...s,
    data: s.data.filter((e) => activeFilter === 'All' || e.level === activeFilter.toLowerCase()),
  })).filter((s) => s.data.length > 0);

  const totalEvents = SECTIONS.reduce((n, s) => n + s.data.length, 0);
  const criticalCount = SECTIONS.reduce((n, s) => n + s.data.filter((e) => e.level === 'critical').length, 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Detection History</Text>
        <Text style={styles.subtitle}>Recent sound events & alerts</Text>
      </View>

      <View style={styles.statsStrip}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalEvents}</Text>
          <Text style={styles.statLabel}>Total Events</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: LEVEL_CFG.critical.color }]}>{criticalCount}</Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.colors.accent }]}>24h</Text>
          <Text style={styles.statLabel}>Monitoring</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((label) => {
          const isActive = activeFilter === label;
          const cc = label === 'Critical' ? LEVEL_CFG.critical.color : label === 'Medium' ? LEVEL_CFG.medium.color : label === 'Low' ? LEVEL_CFG.low.color : theme.colors.accent;
          return (
            <TouchableOpacity key={label} style={[styles.chip, isActive && { backgroundColor: cc + '22', borderColor: cc }]} activeOpacity={0.7} onPress={() => setActiveFilter(label)}>
              <Text style={[styles.chipText, isActive && { color: cc }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionList
        sections={filteredSections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventCard event={item} />}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionDot} />
            <Text style={styles.sectionTitle}>{title}</Text>
            <View style={styles.sectionLine} />
          </View>
        )}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={48} color={theme.colors.textTertiary} />
            <Text style={styles.emptyText}>No events match this filter</Text>
          </View>
        }
        ListFooterComponent={
          filteredSections.length > 0 ? (
            <View style={styles.footer}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.textTertiary} />
              <Text style={styles.footerText}>Events are auto-logged when sounds are detected</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4 },

  statsStrip: { flexDirection: 'row', marginHorizontal: 24, backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 16, marginBottom: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.textTertiary, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, backgroundColor: theme.colors.border },

  filterRow: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0, paddingTop: 20, paddingBottom: 10, gap: 8 },
  sectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  sectionLine: { flex: 1, height: 1, backgroundColor: theme.colors.border, marginLeft: 8 },

  listContent: { paddingHorizontal: 24 },

  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  cardInfo: { flex: 1, marginLeft: 14 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta: { fontSize: 12, color: theme.colors.textTertiary },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.colors.textTertiary, opacity: 0.5, marginHorizontal: 2 },

  levelBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, gap: 5 },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  levelText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 16, color: theme.colors.textTertiary },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 32 },
  footerText: { fontSize: 13, color: theme.colors.textTertiary },
});
