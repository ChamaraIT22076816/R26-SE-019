/**
 * SoundGuard — Visual alert flash
 * ─────────────────────────────────────────────────────────────────────────────
 * A full-screen strobe fired on critical detections, gated by the
 * `visualFlash` setting.
 *
 * This is the accessible substitute for a camera-LED flash: the app targets
 * Deaf and hard-of-hearing users, a screen strobe is visible whether or not the
 * phone is face-down-in-a-pocket, and — unlike torch control — it needs no
 * additional native module, so the existing development build keeps working.
 *
 * The whole animation runs on the UI thread and the view is
 * `pointerEvents="none"`, so it can never intercept a tap or block the
 * detection pipeline.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useEngineActions } from '@/providers/EngineProvider';
import { useSettings } from '@/providers/SettingsProvider';
import { useColors } from '@/providers/ThemeProvider';

export function FlashOverlay() {
  const { settings } = useSettings();
  const { onEvent } = useEngineActions();
  const c = useColors();

  const opacity = useSharedValue(0);

  useEffect(() => {
    const unsubscribe = onEvent((event) => {
      if (event.type !== 'detection') return;
      if (!settings.visualFlash) return;
      if (event.detection.threat !== 'critical') return;

      cancelAnimation(opacity);
      const on = { duration: 90, easing: Easing.linear };
      const off = { duration: 130, easing: Easing.linear };
      opacity.value = withSequence(
        withTiming(0.85, on),
        withTiming(0, off),
        withTiming(0.85, on),
        withTiming(0, off),
        withTiming(0.85, on),
        withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }),
      );
    });

    return () => {
      unsubscribe();
      cancelAnimation(opacity);
    };
  }, [onEvent, opacity, settings.visualFlash]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: c.critical }, style]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 999, elevation: 999 },
});
