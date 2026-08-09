/**
 * SoundGuard — Listen (home)
 * ─────────────────────────────────────────────────────────────────────────────
 * The live monitoring surface.
 *
 * Render discipline, which is what keeps this screen in step with the engine:
 *
 *   • Engine state arrives through `useSyncExternalStore`, and the engine only
 *     notifies on a genuine change. Idle listening schedules no renders at all.
 *   • The orb and level meter read the microphone level from a shared value on
 *     the UI thread, so the visualiser is decoupled from React entirely.
 *   • Every control is synchronous. Dismiss, reset and mute all mutate engine
 *     or settings state in the tap handler, so the UI responds in the same
 *     frame rather than waiting on a round trip through the audio pipeline.
 */

import React, { useCallback, useMemo } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { DetectionCard } from '@/components/DetectionCard';
import { LevelMeter, ListeningOrb } from '@/components/ListeningVisualizer';
import { AppButton, Card, SectionLabel, type IconName } from '@/components/ui';
import { alpha, radius, space, threatColors, typography as typeScale } from '@/constants/theme';
import { useEngineActions, useEngineState } from '@/providers/EngineProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { makeStyles, useColors } from '@/providers/ThemeProvider';
import {
  SOUND_DISPLAY_NAMES,
  SOUND_ICONS,
  type SoundLabel,
} from '@/utils/storage';

const DEMO_SOUNDS: { label: SoundLabel; caption: string }[] = [
  { label: 'door_wood_knock', caption: 'Routine' },
  { label: 'car_horn', caption: 'Attention' },
  { label: 'siren', caption: 'Critical' },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingHorizontal: space.xxl, paddingBottom: space.xxxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.primarySoft,
  },
  brandName: { ...typeScale.heading, color: c.text },
  brandSub: { ...typeScale.caption, color: c.textMuted, marginTop: 1 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusPillText: { ...typeScale.overline, textTransform: 'uppercase' },

  stage: { alignItems: 'center', paddingVertical: space.lg },
  headline: { ...typeScale.title, color: c.text, textAlign: 'center', marginTop: space.xl },
  subline: {
    ...typeScale.body,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 21,
    paddingHorizontal: space.md,
  },
  meterWrap: { marginTop: space.lg, marginBottom: space.sm },

  block: { marginTop: space.lg },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.border,
    backgroundColor: c.surfaceAlt,
  },
  bannerText: { flex: 1, ...typeScale.caption, color: c.textSecondary, lineHeight: 18 },
  bannerAction: { ...typeScale.captionStrong, color: c.primary, paddingHorizontal: 6, paddingVertical: 4 },

  errorCard: { borderColor: alpha(c.critical, 0.35), backgroundColor: c.criticalSoft },
  errorText: { flex: 1, ...typeScale.caption, color: c.critical, lineHeight: 19 },

  idleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  idleText: { flex: 1, ...typeScale.caption, color: c.textMuted, lineHeight: 19 },

  controls: { marginTop: space.xl, gap: space.md },
  secondaryRow: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },

  diagnostics: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: space.lg,
  },
  diagnosticsText: {
    ...typeScale.caption,
    color: c.textMuted,
    fontVariant: ['tabular-nums'],
  },

  demoRow: { flexDirection: 'row', gap: space.sm },
  demoChip: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  demoChipLabel: { ...typeScale.captionStrong, color: c.text, textAlign: 'center' },
  demoChipCaption: { fontSize: 11, color: c.textMuted },
  demoNote: {
    ...typeScale.caption,
    color: c.textMuted,
    marginTop: space.md,
    lineHeight: 18,
  },
}));

export default function ListenScreen() {
  const styles = useStyles();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const state = useEngineState();
  const actions = useEngineActions();
  const { settings, update } = useSettings();

  const listening = state.status === 'listening';
  const starting = state.status === 'starting';
  const detection = state.detection;

  const orbSize = Math.min(Math.max(width - 128, 180), 250);

  // ── Presentation derived from engine state ──
  const tone = useMemo(() => {
    if (detection) return threatColors(c, detection.threat);
    if (listening) return { fg: c.primary, bg: c.primarySoft, label: 'Listening' };
    return { fg: c.textMuted, bg: c.surfaceAlt, label: 'Paused' };
  }, [c, detection, listening]);

  const orbIcon: IconName = detection
    ? ((SOUND_ICONS[detection.label] ?? 'volume-high-outline') as IconName)
    : listening
      ? 'mic'
      : 'mic-off-outline';

  const headline = detection
    ? detection.name
    : listening
      ? 'Listening'
      : starting
        ? 'Starting…'
        : 'Monitoring paused';

  const subline = detection
    ? detection.threat === 'critical'
      ? 'A critical sound is active in your environment.'
      : detection.threat === 'warning'
        ? 'Something nearby may need your attention.'
        : 'A routine sound was recognised nearby.'
    : listening
      ? state.modelStatus === 'ready'
        ? 'Your surroundings are being analysed on this device.'
        : 'Preparing the on-device recognition model…'
      : 'Start monitoring to be alerted to important sounds around you.';

  const statusLabel = starting
    ? 'Starting'
    : listening
      ? state.analyzing
        ? 'Analysing'
        : 'Live'
      : state.modelStatus === 'loading'
        ? 'Loading'
        : 'Paused';

  // ── Handlers ──
  const handleMute = useCallback(() => {
    if (!detection) return;
    if (settings.mutedSounds.includes(detection.label)) {
      actions.dismiss();
      return;
    }
    update('mutedSounds', [...settings.mutedSounds, detection.label]);
  }, [actions, detection, settings.mutedSounds, update]);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  const dismissedNames = state.dismissed.map((l) => SOUND_DISPLAY_NAMES[l]).join(', ');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="pulse" size={19} color={c.primary} />
            </View>
            <View>
              <Text style={styles.brandName}>SoundGuard</Text>
              <Text style={styles.brandSub}>On-device sound awareness</Text>
            </View>
          </View>

          <View
            style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: alpha(tone.fg, 0.3) }]}
          >
            <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
            <Text style={[styles.statusPillText, { color: tone.fg }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* ── Stage ── */}
        <View style={styles.stage}>
          <ListeningOrb
            size={orbSize}
            color={tone.fg}
            icon={orbIcon}
            active={listening || starting}
          />

          <Text style={styles.headline} numberOfLines={2}>
            {headline}
          </Text>
          <Text style={styles.subline}>{subline}</Text>

          <View style={styles.meterWrap}>
            <LevelMeter color={tone.fg} active={listening} />
          </View>
        </View>

        {/* ── Permission / model errors ── */}
        {state.error ? (
          <Card style={[styles.block, styles.errorCard]}>
            <View style={styles.idleRow}>
              <Ionicons name="alert-circle-outline" size={20} color={c.critical} />
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
            {state.permission === 'denied' ? (
              <AppButton
                label="Open system settings"
                icon="open-outline"
                variant="ghost"
                onPress={openSystemSettings}
                style={{ marginTop: space.md }}
                block
              />
            ) : null}
          </Card>
        ) : null}

        {/* ── Active detection, or the idle explainer ── */}
        {detection ? (
          <View style={styles.block}>
            <DetectionCard
              detection={detection}
              onDismiss={actions.dismiss}
              onMute={handleMute}
              onReset={actions.reset}
            />
          </View>
        ) : (
          <Card style={styles.block}>
            <View style={styles.idleRow}>
              <Ionicons
                name={listening ? 'shield-checkmark-outline' : 'information-circle-outline'}
                size={20}
                color={c.textMuted}
              />
              <Text style={styles.idleText}>
                {listening
                  ? 'Nothing unusual right now. Detected sounds appear here instantly, with controls to dismiss or mute them.'
                  : `Sensitivity is set to level ${settings.sensitivity} of 5. Adjust it any time in Settings — changes apply while listening.`}
              </Text>
            </View>
          </Card>
        )}

        {/* ── Dismissal banner ── */}
        {state.dismissed.length > 0 ? (
          <View style={[styles.banner, styles.block]}>
            <Ionicons name="eye-off-outline" size={17} color={c.textMuted} />
            <Text style={styles.bannerText}>
              Temporarily ignoring {dismissedNames}
            </Text>
            <Pressable onPress={actions.undoDismiss} hitSlop={8} accessibilityRole="button">
              <Text style={styles.bannerAction}>Undo</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Primary controls ── */}
        <View style={styles.controls}>
          <AppButton
            label={listening ? 'Stop monitoring' : 'Start monitoring'}
            icon={listening ? 'stop-circle-outline' : 'mic-outline'}
            variant={listening ? 'secondary' : 'primary'}
            size="lg"
            block
            disabled={starting}
            onPress={actions.toggle}
          />

          <View style={styles.secondaryRow}>
            <AppButton
              label="Reset listening"
              icon="refresh"
              variant="ghost"
              onPress={actions.reset}
              style={styles.flex}
            />
            <AppButton
              label={settings.hapticFeedback ? 'Haptics on' : 'Haptics off'}
              icon={settings.hapticFeedback ? 'notifications' : 'notifications-off-outline'}
              variant="ghost"
              onPress={() => update('hapticFeedback', !settings.hapticFeedback)}
              style={styles.flex}
            />
          </View>
        </View>

        {/* ── Live diagnostics ── */}
        {listening && state.windowsAnalyzed > 0 ? (
          <View style={styles.diagnostics}>
            <Ionicons name="speedometer-outline" size={13} color={c.textMuted} />
            <Text style={styles.diagnosticsText}>
              {state.lastLatencyMs} ms per window · {state.windowsAnalyzed} analysed
            </Text>
          </View>
        ) : null}

        {/* ── Demo triggers ── */}
        <SectionLabel icon="flask-outline">Demo</SectionLabel>
        <View style={styles.demoRow}>
          {DEMO_SOUNDS.map((demo) => (
            <Pressable
              key={demo.label}
              onPress={() => actions.simulate(demo.label)}
              accessibilityRole="button"
              accessibilityLabel={`Simulate ${SOUND_DISPLAY_NAMES[demo.label]}`}
              android_ripple={{ color: alpha(c.text, 0.07) }}
              style={({ pressed }) => [styles.demoChip, pressed && { opacity: 0.65 }]}
            >
              <Ionicons
                name={(SOUND_ICONS[demo.label] ?? 'volume-high-outline') as IconName}
                size={18}
                color={c.textSecondary}
              />
              <Text style={styles.demoChipLabel} numberOfLines={1}>
                {SOUND_DISPLAY_NAMES[demo.label]}
              </Text>
              <Text style={styles.demoChipCaption}>{demo.caption}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.demoNote}>
          Simulated events run through the same state pipeline as live audio, so alert behaviour and
          SOS escalation can be demonstrated without producing the sound.
        </Text>
      </ScrollView>
    </View>
  );
}
