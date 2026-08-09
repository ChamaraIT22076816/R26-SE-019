/**
 * SoundGuard — Active detection card
 * ─────────────────────────────────────────────────────────────────────────────
 * The interactive surface for whatever the engine is currently reporting.
 *
 * Controls, all synchronous so the UI responds in the same frame as the tap:
 *   Dismiss  — drop this detection and suppress the class for a cool-off period
 *   Mute     — never surface this class again (persisted setting)
 *   Reset    — flush the audio buffer and start listening cleanly
 *
 * The entrance animation is driven manually rather than with layout animations,
 * and keys off the detection id — which the engine keeps stable while the same
 * class persists — so a sound that keeps sounding updates in place instead of
 * replaying its intro on every window.
 */

import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { alpha, elevation, radius, space, threatColors, typography as typeScale } from '@/constants/theme';
import { makeStyles, useColors } from '@/providers/ThemeProvider';
import { SOUND_ICONS } from '@/utils/storage';
import type { Detection } from '@/utils/soundEngine';
import { AppButton, type IconName } from './ui';

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const useStyles = makeStyles((c) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: c.surface,
    overflow: 'hidden',
    ...elevation(2, c.shadow),
  },
  accent: { height: 3, width: '100%' },
  body: { padding: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleGroup: { flex: 1 },
  name: { ...typeScale.heading, color: c.text },
  meta: { ...typeScale.caption, color: c.textMuted, marginTop: 2 },
  levelPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  levelText: { ...typeScale.overline, textTransform: 'uppercase' },

  confidenceRow: { marginTop: space.lg, gap: 6 },
  confidenceLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  confidenceCaption: { ...typeScale.caption, color: c.textMuted },
  confidenceValue: { ...typeScale.captionStrong, color: c.textSecondary, fontVariant: ['tabular-nums'] },
  track: { height: 5, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },

  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  flex: { flex: 1 },

  simulated: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  simulatedText: { ...typeScale.caption, color: c.textMuted, flex: 1 },
}));

export const DetectionCard = memo(function DetectionCard({
  detection,
  onDismiss,
  onMute,
  onReset,
}: {
  detection: Detection;
  onDismiss: () => void;
  onMute: () => void;
  onReset: () => void;
}) {
  const styles = useStyles();
  const c = useColors();
  const tone = threatColors(c, detection.threat);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = 0;
    enter.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    // Re-run when the engine reports a genuinely new detection.
  }, [detection.id, enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }],
  }));

  const confidence = Math.round(detection.confidence * 100);
  const icon = (SOUND_ICONS[detection.label] ?? 'volume-high-outline') as IconName;

  return (
    <Animated.View
      style={[styles.card, { borderColor: alpha(tone.fg, 0.35) }, enterStyle]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${detection.name} detected, ${tone.label}, ${confidence} percent confidence`}
    >
      <View style={[styles.accent, { backgroundColor: tone.fg }]} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
            <Ionicons name={icon} size={22} color={tone.fg} />
          </View>

          <View style={styles.titleGroup}>
            <Text style={styles.name} numberOfLines={1}>
              {detection.name}
            </Text>
            <Text style={styles.meta}>Detected at {clockTime(detection.firstSeen)}</Text>
          </View>

          <View
            style={[styles.levelPill, { backgroundColor: tone.bg, borderColor: alpha(tone.fg, 0.35) }]}
          >
            <Text style={[styles.levelText, { color: tone.fg }]}>{tone.label}</Text>
          </View>
        </View>

        <View style={styles.confidenceRow}>
          <View style={styles.confidenceLabels}>
            <Text style={styles.confidenceCaption}>Model confidence</Text>
            <Text style={styles.confidenceValue}>{confidence}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${confidence}%`, backgroundColor: tone.fg }]} />
          </View>
        </View>

        {detection.simulated ? (
          <View style={styles.simulated}>
            <Ionicons name="flask-outline" size={13} color={c.textMuted} />
            <Text style={styles.simulatedText}>
              Simulated event — triggered from the demo controls, not the microphone.
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <AppButton
            label="Dismiss"
            icon="close"
            variant="secondary"
            onPress={onDismiss}
            style={styles.flex}
          />
          <AppButton
            label="Mute"
            icon="volume-mute-outline"
            variant="ghost"
            onPress={onMute}
            style={styles.flex}
          />
          <AppButton
            label="Reset"
            icon="refresh"
            variant="ghost"
            onPress={onReset}
            style={styles.flex}
          />
        </View>
      </View>
    </Animated.View>
  );
});
