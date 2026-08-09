/**
 * SoundGuard — SOS dispatch
 * ─────────────────────────────────────────────────────────────────────────────
 * A four-phase flow: countdown → transmitting → sent (or cancelled).
 *
 * This screen deliberately keeps a single high-contrast emergency identity in
 * both colour schemes. A safety surface that changes appearance with the theme
 * is a surface people have to re-learn under stress, so it does not.
 *
 * It reads live settings: `sosCountdown` sets the abort window, `shareLocation`
 * decides whether GPS is resolved at all, `callFirstContact` adds the dial
 * hand-off, and `hapticFeedback` gates the escalating vibration.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

import { radius, space, typography as typeScale } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { useSettings } from '@/providers/SettingsProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { getContacts, type EmergencyContact } from '@/utils/storage';

// Fixed emergency palette — intentionally scheme-independent.
const INK = '#12060A';
const DEEP = '#3D0912';
const GLOW = '#FF4D6A';
const AMBER = '#F5A524';
const GREEN = '#34D399';
const SKY = '#60A5FA';
const WHITE = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.55)';
const FAINT = 'rgba(255,255,255,0.28)';

const THUMB = 60;
const PAD = 4;
const CANCEL_THRESHOLD = 0.82;

type Phase = 'countdown' | 'transmitting' | 'sent' | 'cancelled';

function haptic(kind: 'tick' | 'urgent' | 'success' | 'heavy', enabled: boolean) {
  if (!enabled || Platform.OS === 'web') return;
  try {
    if (kind === 'tick') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'urgent') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    /* ignore */
  }
}

// ─── Slide to cancel ─────────────────────────────────────────────────────────

function SlideToCancel({ trackWidth, onCancel }: { trackWidth: number; onCancel: () => void }) {
  const max = Math.max(40, trackWidth - THUMB - PAD * 2);
  const x = useSharedValue(0);
  const done = useSharedValue(false);

  const fire = useCallback(() => onCancel(), [onCancel]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(6)
        .onUpdate((e) => {
          if (done.value) return;
          x.value = Math.max(0, Math.min(e.translationX, max));
        })
        .onEnd(() => {
          if (done.value) return;
          if (x.value / max > CANCEL_THRESHOLD) {
            done.value = true;
            x.value = withTiming(max, { duration: 110 });
            runOnJS(fire)();
          } else {
            x.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
          }
        }),
    [done, fire, max, x],
  );

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({
    width: x.value + THUMB + PAD,
    backgroundColor: interpolateColor(
      x.value / max,
      [0, 1],
      ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.22)'],
    ),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value / max, [0, 0.45], [1, 0]),
  }));

  return (
    <View style={[styles.sliderTrack, { width: trackWidth }]}>
      <Animated.View style={[styles.sliderFill, fillStyle]} />
      <Animated.View style={[styles.sliderLabelWrap, labelStyle]} pointerEvents="none">
        <Text style={styles.sliderLabel}>Slide to cancel</Text>
        <Ionicons name="chevron-forward" size={15} color={FAINT} />
        <Ionicons name="chevron-forward" size={15} color={FAINT} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.sliderThumb, thumbStyle]}
          accessibilityRole="adjustable"
          accessibilityLabel="Slide to cancel the SOS"
        >
          <Ionicons name="close" size={26} color={DEEP} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SosAlertScreen() {
  const { settings } = useSettings();
  const { reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const r = useResponsive();
  const { width } = r;

  const total = Math.max(3, settings.sosCountdown);
  const [remaining, setRemaining] = useState(total);
  const [phase, setPhase] = useState<Phase>('countdown');
  const [status, setStatus] = useState('');
  const [firstContact, setFirstContact] = useState<EmergencyContact | null>(null);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pulse = useSharedValue(0);
  const enter = useSharedValue(0);

  // ── Entrance ──
  useEffect(() => {
    enter.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [enter]);

  // ── Background pulse ──
  useEffect(() => {
    if (reduceMotion || phase !== 'countdown') {
      cancelAnimation(pulse);
      pulse.value = withTiming(0.35, { duration: 300 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 620, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [phase, pulse, reduceMotion]);

  // ── Countdown ──
  useEffect(() => {
    if (phase !== 'countdown') return;

    haptic('urgent', settings.hapticFeedback);

    tickRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          setPhase('transmitting');
          return 0;
        }
        haptic(prev <= 4 ? 'urgent' : 'tick', settings.hapticFeedback);
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase, settings.hapticFeedback]);

  // ── Dispatch ──
  useEffect(() => {
    if (phase !== 'transmitting') return;
    let cancelled = false;

    (async () => {
      let locationLine = '';

      if (settings.shareLocation) {
        setStatus('Resolving your location…');
        try {
          const { status: permission } = await Location.requestForegroundPermissionsAsync();
          if (permission === 'granted') {
            const fix = await Promise.race([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
            ]);
            if (fix && typeof fix === 'object' && 'coords' in fix) {
              const { latitude, longitude } = fix.coords;
              locationLine = ` My location: https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
            } else {
              locationLine = ' Location could not be determined in time.';
            }
          } else {
            locationLine = ' Location permission was not granted.';
          }
        } catch {
          locationLine = ' Location could not be determined.';
        }
      }
      if (cancelled) return;

      setStatus('Loading your Safety Circle…');
      let contacts: EmergencyContact[] = [];
      try {
        contacts = await getContacts();
      } catch {
        contacts = [];
      }
      if (cancelled) return;

      setFirstContact(contacts[0] ?? null);
      const numbers = contacts.map((c) => c.phone).filter(Boolean);
      const message = `EMERGENCY — I need help. This alert was sent by SoundGuard.${locationLine}`;

      if (numbers.length > 0) {
        setStatus(`Opening a message to ${numbers.length} contact${numbers.length > 1 ? 's' : ''}…`);
        try {
          if (await SMS.isAvailableAsync()) {
            await SMS.sendSMSAsync(numbers, message);
          } else {
            setStatus('SMS is unavailable on this device.');
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
        } catch {
          /* the user may have dismissed the composer — treat as handled */
        }
      } else {
        setStatus('No contacts saved — nobody to notify.');
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (cancelled) return;

      haptic('success', settings.hapticFeedback);
      setPhase('sent');
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, settings.hapticFeedback, settings.shareLocation]);

  // ── Auto-dismiss after success ──
  useEffect(() => {
    if (phase !== 'sent' && phase !== 'cancelled') return;
    const delay = phase === 'cancelled' ? 700 : settings.callFirstContact && firstContact ? 8000 : 3500;
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, settings.callFirstContact, firstContact]);

  const handleCancel = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    haptic('success', settings.hapticFeedback);
    setPhase('cancelled');
  }, [settings.hapticFeedback]);

  const handleCall = useCallback(() => {
    if (!firstContact) return;
    const sanitised = firstContact.phone.replace(/[^\d+]/g, '');
    void Linking.openURL(`tel:${sanitised}`).catch(() => {});
  }, [firstContact]);

  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.2, 0.5]),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: interpolate(enter.value, [0, 1], [24, 0]) }],
  }));

  const accent =
    phase === 'sent' ? GREEN : phase === 'cancelled' ? SKY : phase === 'transmitting' ? AMBER : GLOW;

  const heading =
    phase === 'sent'
      ? 'SOS sent'
      : phase === 'cancelled'
        ? 'Alert cancelled'
        : phase === 'transmitting'
          ? 'Sending SOS'
          : 'Critical sound detected';

  const subheading =
    phase === 'sent'
      ? 'Your Safety Circle has been notified.'
      : phase === 'cancelled'
        ? 'No message was sent.'
        : phase === 'transmitting'
          ? status || 'Preparing your alert…'
          : 'An SOS will be prepared automatically.';

  const trackWidth = Math.min(width - r.hPadding * 2, 420);
  // The countdown is the single most important glyph on the screen; scale it to
  // the viewport instead of letting an 88 pt digit pair collide on a 320 dp phone.
  const timerSize = Math.round(Math.min(96, Math.max(56, r.contentWidth * 0.26)));

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.base} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.wash, backdropStyle]} />
      </View>

      <Animated.View
        style={[
          styles.content,
          contentStyle,
          {
            paddingHorizontal: r.hPadding,
            paddingTop: insets.top + (r.isShort ? space.xl : space.xxxl),
            paddingBottom: Math.max(insets.bottom, space.lg) + space.xxl,
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.badge, { borderColor: accent }]}>
            <Ionicons
              name={
                phase === 'sent'
                  ? 'checkmark'
                  : phase === 'cancelled'
                    ? 'close'
                    : phase === 'transmitting'
                      ? 'paper-plane-outline'
                      : 'warning-outline'
              }
              size={26}
              color={accent}
            />
          </View>
          <Text style={[styles.heading, { color: accent }]}>{heading}</Text>
          <Text style={styles.subheading}>{subheading}</Text>
        </View>

        {/* Centre */}
        <View style={styles.centre}>
          {phase === 'countdown' ? (
            <>
              <Text style={[styles.timer, { fontSize: timerSize }]}>
                {`0:${String(remaining).padStart(2, '0')}`}
              </Text>
              <Text style={styles.timerCaption}>until your contacts are messaged</Text>
              <View style={styles.dots}>
                {Array.from({ length: total }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i < total - remaining ? GLOW : 'rgba(255,255,255,0.16)' },
                    ]}
                  />
                ))}
              </View>
            </>
          ) : phase === 'transmitting' ? (
            <>
              <ActivityIndicator size="large" color={AMBER} />
              <Text style={[styles.timerCaption, { marginTop: space.xl }]}>{status}</Text>
            </>
          ) : (
            <>
              <View style={[styles.resultRing, { borderColor: accent }]}>
                <Ionicons
                  name={phase === 'sent' ? 'checkmark' : 'close'}
                  size={52}
                  color={accent}
                />
              </View>
              <Text style={[styles.timerCaption, { marginTop: space.xl }]}>
                {phase === 'sent'
                  ? settings.shareLocation
                    ? 'Message prepared with your location.'
                    : 'Message prepared without location.'
                  : 'Returning to monitoring.'}
              </Text>
            </>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {phase === 'countdown' ? (
            <>
              <SlideToCancel trackWidth={trackWidth} onCancel={handleCancel} />
              <Text style={styles.hint}>Drag the button all the way across to abort</Text>
            </>
          ) : null}

          {phase === 'sent' && settings.callFirstContact && firstContact ? (
            <Pressable
              onPress={handleCall}
              accessibilityRole="button"
              accessibilityLabel={`Call ${firstContact.name}`}
              style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="call" size={19} color={INK} />
              <Text style={styles.callText}>{`Call ${firstContact.name}`}</Text>
            </Pressable>
          ) : null}

          {phase === 'sent' || phase === 'cancelled' ? (
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.dismissButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.dismissText}>Close</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: INK },
  wash: { backgroundColor: DEEP },

  content: { flex: 1, justifyContent: 'space-between' },

  header: { alignItems: 'center' },
  badge: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heading: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    marginTop: space.lg,
    textAlign: 'center',
  },
  subheading: {
    ...typeScale.body,
    color: MUTED,
    marginTop: space.sm,
    textAlign: 'center',
    lineHeight: 21,
  },

  centre: { alignItems: 'center', justifyContent: 'center' },
  timer: {
    fontWeight: '200',
    color: WHITE,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  timerCaption: { ...typeScale.caption, color: MUTED, textAlign: 'center', lineHeight: 20 },
  dots: { flexDirection: 'row', gap: 6, marginTop: space.xl },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  resultRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  footer: { alignItems: 'center', gap: space.lg },

  sliderTrack: {
    height: THUMB + PAD * 2,
    borderRadius: (THUMB + PAD * 2) / 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: (THUMB + PAD * 2) / 2,
  },
  sliderLabelWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingLeft: THUMB,
  },
  sliderLabel: {
    ...typeScale.captionStrong,
    color: MUTED,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginRight: 4,
  },
  sliderThumb: {
    position: 'absolute',
    left: PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { ...typeScale.caption, color: FAINT },

  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: GREEN,
  },
  callText: { ...typeScale.bodyStrong, color: INK },

  dismissButton: { paddingVertical: 12, paddingHorizontal: space.xxl },
  dismissText: { ...typeScale.bodyStrong, color: MUTED },
});
