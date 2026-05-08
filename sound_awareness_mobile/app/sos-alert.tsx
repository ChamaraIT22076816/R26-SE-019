import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolate,
  interpolateColor,
  cancelAnimation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Constants ───────────────────────────────────────────────────
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SLIDER_TRACK_WIDTH = SCREEN_WIDTH - 80;
const SLIDER_THUMB_SIZE = 64;
const SLIDER_PADDING = 4;
const SLIDER_MAX_TRANSLATE = SLIDER_TRACK_WIDTH - SLIDER_THUMB_SIZE - SLIDER_PADDING * 2;
const CANCEL_THRESHOLD = 0.85;
const SOS_COUNTDOWN = 10;

// Color palette — aggressive deep reds
const RED_ABYSS = '#0D0204';
const RED_DEEP = '#1A0408';
const RED_CORE = '#6B0F1A';
const RED_MEDIUM = '#8B1A2B';
const RED_HOT = '#CC2244';
const RED_BRIGHT = '#FF2D55';
const RED_GLOW = '#FF4D6A';
const RED_FLASH = '#FF6680';

// ─── Haptic helper (safe for web) ────────────────────────────────
function triggerHaptic(type: 'heavy' | 'warning' | 'success' | 'error') {
  try {
    if (Platform.OS === 'web') return;
    switch (type) {
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch (_) {}
}

// ─── Pulsing Background Ring ─────────────────────────────────────
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }),
        -1,
        false
      )
    );
    return () => cancelAnimation(progress);
  }, []);

  const animStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.3, 1.5]);
    const opacity = interpolate(progress.value, [0, 0.15, 0.6, 1], [0.5, 0.35, 0.12, 0]);
    return { transform: [{ scale }], opacity };
  });

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        { width: size, height: size, borderRadius: size / 2 },
        animStyle,
      ]}
    />
  );
}

// ─── Countdown Arc Indicator ─────────────────────────────────────
function CountdownGlowRing({ countdown }: { countdown: number }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(pulse);
  }, []);

  const animStyle = useAnimatedStyle(() => {
    const glowOpacity = interpolate(pulse.value, [0, 1], [0.15, 0.5]);
    return {
      borderColor: RED_BRIGHT,
      opacity: glowOpacity,
    };
  });

  const size = 200;
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
        },
        animStyle,
      ]}
    />
  );
}

// ─── Slide-to-Cancel Component (using react-native-gesture-handler) ──
function SlideToCancel({ onCancel }: { onCancel: () => void }) {
  const translateX = useSharedValue(0);
  const completionRatio = useSharedValue(0);
  const isCompleted = useSharedValue(false);

  // Shimmer animation for the label chevrons
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(shimmer);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const panGesture = Gesture.Pan()
    .activeOffsetX(5)
    .onUpdate((event) => {
      if (isCompleted.value) return;
      const x = Math.max(0, Math.min(event.translationX, SLIDER_MAX_TRANSLATE));
      translateX.value = x;
      completionRatio.value = x / SLIDER_MAX_TRANSLATE;
    })
    .onEnd(() => {
      if (isCompleted.value) return;
      if (completionRatio.value > CANCEL_THRESHOLD) {
        // Snap to end and fire cancel
        isCompleted.value = true;
        translateX.value = withTiming(SLIDER_MAX_TRANSLATE, { duration: 120 });
        runOnJS(handleCancel)();
      } else {
        // Spring back
        translateX.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) });
        completionRatio.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const textFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(completionRatio.value, [0, 0.4], [1, 0]),
  }));

  // Progress fill behind the thumb
  const fillStyle = useAnimatedStyle(() => ({
    width: translateX.value + SLIDER_THUMB_SIZE + SLIDER_PADDING,
    backgroundColor: interpolateColor(
      completionRatio.value,
      [0, 0.5, 1],
      ['rgba(255, 45, 85, 0.15)', 'rgba(255, 45, 85, 0.3)', 'rgba(255, 45, 85, 0.5)']
    ),
  }));

  // Chevron shimmer
  const chevron1Style = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.6, 0.2, 0.2]),
  }));
  const chevron2Style = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.2, 0.6, 0.2]),
  }));
  const chevron3Style = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.2, 0.2, 0.6]),
  }));

  return (
    <View style={styles.sliderTrack}>
      {/* Progress fill */}
      <Animated.View style={[styles.sliderFill, fillStyle]} />

      {/* Label with animated chevrons */}
      <Animated.View style={[styles.sliderTextContainer, textFadeStyle]}>
        <Animated.View style={chevron1Style}>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
        </Animated.View>
        <Animated.View style={chevron2Style}>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
        </Animated.View>
        <Text style={styles.sliderLabel}>Slide to Cancel</Text>
        <Animated.View style={chevron3Style}>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
        </Animated.View>
      </Animated.View>

      {/* Draggable thumb */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.sliderThumb, thumbStyle]}>
          <Ionicons name="close" size={28} color={RED_DEEP} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─── Main SOS Alert Screen ──────────────────────────────────────
export default function SOSAlertScreen() {
  const [countdown, setCountdown] = useState(SOS_COUNTDOWN);
  const [dispatched, setDispatched] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bgPulse = useSharedValue(0);
  const bgFlash = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const toastSlideY = useSharedValue(20);
  const contentFadeIn = useSharedValue(0);

  // ── Entry fade-in ──
  useEffect(() => {
    contentFadeIn.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, []);

  // ── Aggressive pulsing red background ──
  useEffect(() => {
    bgPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 600, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );

    // Rapid flash overlay for urgency
    bgFlash.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 150, easing: Easing.linear }),
        withTiming(0, { duration: 150, easing: Easing.linear }),
        withTiming(0, { duration: 500, easing: Easing.linear })
      ),
      -1,
      false
    );

    return () => {
      cancelAnimation(bgPulse);
      cancelAnimation(bgFlash);
    };
  }, []);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bgPulse.value, [0, 1], [0.15, 0.45]),
  }));

  const bgFlashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bgFlash.value, [0, 1], [0, 0.08]),
  }));

  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: contentFadeIn.value,
    transform: [
      { translateY: interpolate(contentFadeIn.value, [0, 1], [30, 0]) },
    ],
  }));

  // ── Haptic vibration loop — heavy pulse every 800ms ──
  useEffect(() => {
    if (cancelled || dispatched) return;

    // Immediate double-burst on mount
    triggerHaptic('error');
    const burstTimeout = setTimeout(() => triggerHaptic('heavy'), 200);

    hapticRef.current = setInterval(() => {
      triggerHaptic('heavy');
    }, 800);

    return () => {
      clearTimeout(burstTimeout);
      if (hapticRef.current) clearInterval(hapticRef.current);
    };
  }, [cancelled, dispatched]);

  // ── Countdown timer ──
  useEffect(() => {
    if (cancelled || dispatched) return;
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          if (hapticRef.current) clearInterval(hapticRef.current);
          triggerHaptic('success');
          setDispatched(true);
          return 0;
        }
        // Tick haptic — escalates from warning to heavy as time runs out
        if (prev <= 4) {
          triggerHaptic('error');
        } else {
          triggerHaptic('warning');
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [cancelled, dispatched]);

  // ── Auto-dismiss after dispatch ──
  useEffect(() => {
    if (dispatched) {
      // Stop background animations
      cancelAnimation(bgPulse);
      cancelAnimation(bgFlash);
      bgPulse.value = withTiming(0, { duration: 400 });
      bgFlash.value = 0;

      // Show toast
      toastOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
      toastSlideY.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) });

      const timeout = setTimeout(() => dismissModal(), 2800);
      return () => clearTimeout(timeout);
    }
  }, [dispatched]);

  const dismissModal = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, []);

  const handleCancel = useCallback(() => {
    setCancelled(true);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (hapticRef.current) clearInterval(hapticRef.current);
    cancelAnimation(bgPulse);
    cancelAnimation(bgFlash);
    triggerHaptic('success');
    setTimeout(() => dismissModal(), 500);
  }, []);

  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
    transform: [{ translateY: toastSlideY.value }],
  }));

  const displayTime = `00:${countdown.toString().padStart(2, '0')}`;

  // Progress ratio for visual indicators
  const progressRatio = (SOS_COUNTDOWN - countdown) / SOS_COUNTDOWN;

  return (
    <View style={styles.root}>
      {/* ─── Background Layers ─── */}
      <View style={styles.background}>
        {/* Base deep red */}
        <Animated.View style={[styles.bgOverlay, bgStyle]} />
        {/* Flash overlay */}
        <Animated.View style={[styles.bgFlashOverlay, bgFlashStyle]} />

        {/* Expanding pulse rings */}
        <View style={styles.pulseContainer}>
          <PulseRing delay={0} size={340} />
          <PulseRing delay={550} size={340} />
          <PulseRing delay={1100} size={340} />
          <PulseRing delay={1650} size={340} />
        </View>

        {/* Radial gradient vignette */}
        <View style={styles.vignette} />
      </View>

      {/* ─── Content ─── */}
      <Animated.View style={[styles.content, contentFadeStyle]}>
        {/* ── Top: Emergency Badge ── */}
        <View style={styles.topSection}>
          <View style={styles.warningBadge}>
            <View style={styles.warningBadgeInner}>
              <Ionicons name="warning" size={32} color={RED_BRIGHT} />
            </View>
          </View>
          <Text style={styles.emergencyLabel}>EMERGENCY DETECTED</Text>
          <Text style={styles.emergencySub}>
            {dispatched
              ? 'SOS has been dispatched'
              : cancelled
              ? 'Alert cancelled'
              : 'Critical threat identified'}
          </Text>
        </View>

        {/* ── Center: Timer ── */}
        <View style={styles.centerSection}>
          {/* Glow ring behind timer */}
          {!dispatched && !cancelled && <CountdownGlowRing countdown={countdown} />}

          <Text
            style={[
              styles.countdownTimer,
              dispatched && styles.countdownDispatched,
              cancelled && styles.countdownCancelled,
            ]}
          >
            {displayTime}
          </Text>

          <Text
            style={[
              styles.autoDispatchText,
              dispatched && { color: '#4ADE80' },
              cancelled && { color: '#4DA6FF' },
            ]}
          >
            {dispatched
              ? '✓ SOS DISPATCHED'
              : cancelled
              ? '✕ CANCELLED'
              : 'AUTO-DISPATCHING SOS...'}
          </Text>

          <Text style={styles.subText}>
            {dispatched
              ? 'Your safety circle has been notified.\nHelp is on the way.'
              : cancelled
              ? 'Alert has been cancelled successfully.'
              : 'Alerting your Safety Circle & Emergency Services'}
          </Text>

          {/* Progress dots */}
          {!dispatched && !cancelled && (
            <View style={styles.progressDots}>
              {Array.from({ length: SOS_COUNTDOWN }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    {
                      backgroundColor:
                        i < SOS_COUNTDOWN - countdown
                          ? RED_BRIGHT
                          : 'rgba(255, 255, 255, 0.15)',
                    },
                    i === SOS_COUNTDOWN - countdown - 1 && {
                      shadowColor: RED_BRIGHT,
                      shadowOpacity: 0.8,
                      shadowRadius: 6,
                      elevation: 4,
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Bottom: Slider or Toasts ── */}
        <View style={styles.bottomSection}>
          {!dispatched && !cancelled && (
            <View style={styles.sliderContainer}>
              <SlideToCancel onCancel={handleCancel} />
              <Text style={styles.sliderHint}>
                Drag the button to abort the SOS
              </Text>
            </View>
          )}

          {dispatched && (
            <Animated.View style={[styles.toastContainer, styles.toastSuccess, toastStyle]}>
              <View style={styles.toastIconBg}>
                <Ionicons name="checkmark-circle" size={28} color="#4ADE80" />
              </View>
              <View style={styles.toastTextGroup}>
                <Text style={styles.toastTitle}>SOS Dispatched to Safety Circle</Text>
                <Text style={styles.toastSub}>
                  4 contacts notified • Location shared
                </Text>
              </View>
            </Animated.View>
          )}

          {cancelled && (
            <View style={[styles.toastContainer, styles.toastCancelled]}>
              <View style={styles.toastIconBg}>
                <Ionicons name="checkmark-circle" size={28} color="#4DA6FF" />
              </View>
              <View style={styles.toastTextGroup}>
                <Text style={styles.toastTitle}>Alert Cancelled</Text>
                <Text style={styles.toastSub}>
                  Returning to radar...
                </Text>
              </View>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // ── Background layers ──
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: RED_ABYSS,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: RED_CORE,
  },
  bgFlashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: RED_HOT,
  },
  pulseContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: RED_BRIGHT,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    // Dark edges to draw focus to center
    backgroundColor: 'transparent',
    borderWidth: SCREEN_WIDTH * 0.3,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: SCREEN_WIDTH,
  },

  // ── Content ──
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 70,
    paddingBottom: 50,
    paddingHorizontal: 24,
  },

  // ── Top section ──
  topSection: {
    alignItems: 'center',
  },
  warningBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255, 45, 85, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningBadgeInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 45, 85, 0.2)',
    borderWidth: 2,
    borderColor: RED_BRIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: RED_GLOW,
    letterSpacing: 4,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  emergencySub: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 6,
  },

  // ── Center section ──
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownTimer: {
    fontSize: 104,
    fontWeight: '200',
    color: '#FFFFFF',
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(255, 45, 85, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
  },
  countdownDispatched: {
    color: '#4ADE80',
    textShadowColor: 'rgba(74, 222, 128, 0.4)',
  },
  countdownCancelled: {
    color: '#4DA6FF',
    textShadowColor: 'rgba(77, 166, 255, 0.4)',
  },
  autoDispatchText: {
    fontSize: 17,
    fontWeight: '800',
    color: RED_GLOW,
    letterSpacing: 2.5,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  subText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.45)',
    marginTop: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 28,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── Bottom section ──
  bottomSection: {
    alignItems: 'center',
  },
  sliderContainer: {
    width: SLIDER_TRACK_WIDTH,
    alignItems: 'center',
  },

  // ── Slider ──
  sliderTrack: {
    width: '100%',
    height: SLIDER_THUMB_SIZE + SLIDER_PADDING * 2,
    borderRadius: (SLIDER_THUMB_SIZE + SLIDER_PADDING * 2) / 2,
    backgroundColor: 'rgba(255, 45, 85, 0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 45, 85, 0.35)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: (SLIDER_THUMB_SIZE + SLIDER_PADDING * 2) / 2,
  },
  sliderTextContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingLeft: SLIDER_THUMB_SIZE,
  },
  sliderLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginHorizontal: 6,
  },
  sliderThumb: {
    position: 'absolute',
    left: SLIDER_PADDING,
    width: SLIDER_THUMB_SIZE,
    height: SLIDER_THUMB_SIZE,
    borderRadius: SLIDER_THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: RED_BRIGHT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  sliderHint: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.25)',
    marginTop: 14,
  },

  // ── Toast notifications ──
  toastContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 18,
    borderWidth: 1,
  },
  toastSuccess: {
    backgroundColor: 'rgba(74, 222, 128, 0.08)',
    borderColor: 'rgba(74, 222, 128, 0.25)',
  },
  toastCancelled: {
    backgroundColor: 'rgba(77, 166, 255, 0.08)',
    borderColor: 'rgba(77, 166, 255, 0.25)',
  },
  toastIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toastTextGroup: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  toastSub: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
});
