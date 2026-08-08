import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity, Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '@/constants/Colors';
import { getDetectionLog, clearDetectionLog } from '@/utils/storage';
import type { DetectionEvent } from '@/utils/storage';

// ─── Threat level display config ─────────────────────────────────
type HistoryThreatLevel = 'warning' | 'critical';
const LEVEL_CFG: Record<HistoryThreatLevel, {
  color: string; bg: string; label: string; icon: keyof typeof Ionicons.glyphMap;
}> = {
  warning:  { color: '#FFB020', bg: 'rgba(255,176,32,0.12)',  label: 'Warning',  icon: 'warning-outline' },
  critical: { color: '#FF3B5C', bg: 'rgba(255,59,92,0.12)',   label: 'Critical', icon: 'alert-circle-outline' },
};

// Icon map — maps raw model labels to Ionicons glyphs
const LABEL_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  car_horn:        'car-outline',
  crying_baby:     'happy-outline',
  dog:             'paw-outline',
  door_wood_knock: 'notifications-outline',
  footsteps:       'footsteps-outline',
  glass_breaking:  'warning-outline',
  siren:           'medical-outline',
};

// ─── Filter options ───────────────────────────────────────────────
type FilterOption = 'All' | 'Critical' | 'Warning';
const FILTERS: FilterOption[] = ['All', 'Critical', 'Warning'];

// ─── Date grouping helpers ────────────────────────────────────────
function getDateLabel(timestamp: number): string {
  const d     = new Date(timestamp);
  const now   = new Date();
  const diff  = now.getTime() - d.getTime();
  const dayMs = 86400000;

  if (diff < dayMs && d.getDate() === now.getDate()) return 'Today';
  if (diff < 2 * dayMs) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.getDate() === yesterday.getDate()) return 'Yesterday';
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ─── Grouped flat-list item type ─────────────────────────────────
type ListItem =
  | { type: 'header'; label: string; key: string }
  | { type: 'event';  event: DetectionEvent; key: string };

// ─── Event Card ───────────────────────────────────────────────────
function EventCard({ event }: { event: DetectionEvent }) {
  const lc   = LEVEL_CFG[event.threatLevel];
  const icon = LABEL_ICON[event.rawLabel] ?? 'volume-high-outline';
  const conf = Math.round(event.confidence * 100);
  return (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: lc.color }]} />
      <View style={[styles.cardIcon, { backgroundColor: lc.bg }]}>
        <Ionicons name={icon} size={22} color={lc.color} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{event.soundName}</Text>
        <View style={styles.cardMetaRow}>
          <Ionicons name="time-outline" size={12} color={theme.colors.textTertiary} />
          <Text style={styles.cardMeta}>{formatTime(event.timestamp)}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.cardMeta}>{conf}% conf</Text>
        </View>
      </View>
      <View style={[styles.levelBadge, { backgroundColor: lc.bg, borderColor: lc.color + '44' }]}>
        <View style={[styles.levelDot, { backgroundColor: lc.color }]} />
        <Text style={[styles.levelText, { color: lc.color }]}>{lc.label}</Text>
      </View>
    </View>
  );
}

// ─── Section Header ───────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionDot} />
      <Text style={styles.sectionTitle}>{label}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

// ─── Main History Screen ──────────────────────────────────────────
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [events, setEvents]             = useState<DetectionEvent[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('All');

  // Reload detection log every time the tab gains focus
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        const log = await getDetectionLog();
        if (!cancelled) {
          setEvents(log);
          setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // Apply filter
  const filtered = useMemo(() => {
    if (activeFilter === 'All') return events;
    return events.filter((e) => e.threatLevel === activeFilter.toLowerCase());
  }, [events, activeFilter]);

  // Build flat list with interleaved section headers
  const listItems = useMemo((): ListItem[] => {
    const items: ListItem[] = [];
    let lastLabel = '';
    for (const event of filtered) {
      const label = getDateLabel(event.timestamp);
      if (label !== lastLabel) {
        items.push({ type: 'header', label, key: `header-${label}-${event.id}` });
        lastLabel = label;
      }
      items.push({ type: 'event', event, key: event.id });
    }
    return items;
  }, [filtered]);

  // Stats derived from full (unfiltered) events array
  const totalEvents   = events.length;
  const criticalCount = events.filter((e) => e.threatLevel === 'critical').length;
  const warningCount  = events.filter((e) => e.threatLevel === 'warning').length;

  const handleClearAll = () => {
    Alert.alert(
      'Clear All History',
      'This will permanently delete all detection events. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All', style: 'destructive',
          onPress: async () => {
            await clearDetectionLog();
            setEvents([]);
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') return <SectionHeader label={item.label} />;
    return <EventCard event={item.event} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Detection History</Text>
            <Text style={styles.subtitle}>Real-time sound event log</Text>
          </View>
          {events.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              activeOpacity={0.7}
              onPress={handleClearAll}
            >
              <Ionicons name="trash-outline" size={16} color={theme.colors.urgent} />
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Stats strip ── */}
      <View style={styles.statsStrip}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalEvents}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#FF3B5C' }]}>{criticalCount}</Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#FFB020' }]}>{warningCount}</Text>
          <Text style={styles.statLabel}>Warning</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Ionicons name="radio" size={16} color={theme.colors.accent} />
          <Text style={[styles.statLabel, { marginTop: 2 }]}>Live</Text>
        </View>
      </View>

      {/* ── Filter chips ── */}
      <View style={styles.filterRow}>
        {FILTERS.map((label) => {
          const isActive = activeFilter === label;
          const cc =
            label === 'Critical' ? '#FF3B5C'
            : label === 'Warning'  ? '#FFB020'
            : theme.colors.accent;
          return (
            <TouchableOpacity
              key={label}
              style={[styles.chip, isActive && { backgroundColor: cc + '22', borderColor: cc }]}
              activeOpacity={0.7}
              onPress={() => setActiveFilter(label)}
            >
              <Text style={[styles.chipText, isActive && { color: cc }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── List / loading / empty ── */}
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconRing}>
                <Ionicons name="ear-outline" size={40} color={theme.colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>No Detections Yet</Text>
              <Text style={styles.emptySubtitle}>
                Start Live Detection on the Radar tab to begin{'\n'}monitoring your environment.
              </Text>
              {activeFilter !== 'All' && (
                <TouchableOpacity
                  style={styles.resetFilterBtn}
                  onPress={() => setActiveFilter('All')}
                >
                  <Text style={styles.resetFilterText}>Show All Events</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListFooterComponent={
            listItems.length > 0 ? (
              <View style={styles.footer}>
                <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
                <Text style={styles.footerText}>
                  Showing {filtered.length} of {totalEvents} event{totalEvents !== 1 ? 's' : ''}
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: theme.colors.background },
  header:       { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 },
  headerRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title:        { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle:     { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4 },

  clearBtn:     {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: theme.colors.urgent + '12',
    borderWidth: 1, borderColor: theme.colors.urgent + '33', marginTop: 8,
  },
  clearBtnText: { fontSize: 13, fontWeight: '700', color: theme.colors.urgent },

  statsStrip:   {
    flexDirection: 'row', marginHorizontal: 24,
    backgroundColor: theme.colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingVertical: 14, marginBottom: 16, alignItems: 'center',
  },
  statItem:     { flex: 1, alignItems: 'center' },
  statValue:    { fontSize: 20, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  statLabel:    {
    fontSize: 11, fontWeight: '600', color: theme.colors.textTertiary,
    marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statDivider:  { width: 1, height: 32, backgroundColor: theme.colors.border },

  filterRow:    { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
  chip:         {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
  },
  chipText:     { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 20, paddingBottom: 10, gap: 8 },
  sectionDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  sectionTitle:  {
    fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  sectionLine:   { flex: 1, height: 1, backgroundColor: theme.colors.border, marginLeft: 8 },

  listContent:  { paddingHorizontal: 24 },

  card:         {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.surface, borderRadius: 14,
    padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden',
  },
  cardAccent:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  cardIcon:     { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  cardInfo:     { flex: 1, marginLeft: 14 },
  cardTitle:    { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  cardMetaRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta:     { fontSize: 12, color: theme.colors.textTertiary },
  metaDot:      { width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.colors.textTertiary, opacity: 0.5, marginHorizontal: 2 },

  levelBadge:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, gap: 5 },
  levelDot:     { width: 6, height: 6, borderRadius: 3 },
  levelText:    { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },

  emptyState:      { alignItems: 'center', paddingHorizontal: 32, paddingTop: 48, gap: 12 },
  emptyIconRing:   {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: theme.colors.accent + '15',
    borderWidth: 1.5, borderColor: theme.colors.accent + '30',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle:      { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  emptySubtitle:   { fontSize: 14, color: theme.colors.textTertiary, textAlign: 'center', lineHeight: 22 },
  resetFilterBtn:  {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999,
    backgroundColor: theme.colors.accent + '15', borderWidth: 1, borderColor: theme.colors.accent + '44',
  },
  resetFilterText: { fontSize: 14, fontWeight: '700', color: theme.colors.accent },

  footer:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 24 },
  footerText: { fontSize: 12, color: theme.colors.textTertiary },
});
