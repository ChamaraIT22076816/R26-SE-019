/**
 * SoundGuard mode — tab layout
 * ─────────────────────────────────────────────────────────────────────────────
 * The four surfaces of environmental sound monitoring. The group name carries
 * no URL segment, so these are `/listen`, `/history`, `/circle` and `/settings`.
 *
 * ── Microphone release (hardware isolation, layer 2) ─────────────────────────
 *
 * This layout owns the *mode*, so this is where the mode's hardware is given
 * back. Two independent triggers, because they fail in different ways:
 *
 *   • blur   — fires when the user leaves for the dashboard, for Live
 *              Transcribe, or for the SOS screen, even if React keeps the
 *              screen mounted underneath the new one.
 *   • unmount— fires when the group is actually popped or replaced, including
 *              paths that never produce a blur (a `replace` straight into the
 *              other mode, or a navigation state restored by the OS).
 *
 * Both call the same idempotent `stop()`, so running both is free. Switching
 * *between* tabs does not trigger either one: focus here tracks the group's
 * screen in the parent stack, not the child tab, which is exactly right —
 * checking history mid-detection must not stop monitoring.
 *
 * ── Why backgrounding is handled here, not in EngineProvider ─────────────────
 *
 * The `backgroundListening` setting decides whether capture survives the app
 * going to the background, and therefore whether it should be resumed when the
 * app comes back. That resume is only ever correct *inside this mode*. Owning
 * it from the app-wide provider meant a user who backgrounded SoundGuard, came
 * back, and navigated to Live Transcribe could have monitoring silently
 * re-opened underneath them. Anchoring the listener to this layout makes the
 * bug unrepresentable: the subscription is torn down with the mode, so there is
 * nothing left to resume into.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings } from '@/providers/SettingsProvider';
import { useColors } from '@/providers/ThemeProvider';
import { audioArbiter } from '@/utils/audioArbiter';
import { soundEngine } from '@/utils/soundEngine';

export default function GuardLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();

  // Leaving the mode releases the microphone. `stop()` is synchronous for the
  // UI and hands the native teardown to the arbiter, so the hardware is free
  // before the other mode can possibly ask for it.
  useFocusEffect(
    useCallback(
      () => () => {
        soundEngine.stop();
      },
      [],
    ),
  );

  useEffect(
    () => () => {
      soundEngine.stop();
    },
    [],
  );

  // ── Background behaviour, driven by the `backgroundListening` setting ──
  const autoPaused = useRef(false);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') {
        if (!autoPaused.current) return;
        autoPaused.current = false;
        // Resume only into a free microphone. Anything else means ownership
        // moved while we were away, and it is not ours to take back.
        if (audioArbiter.getOwner() !== null) return;
        void soundEngine.start();
        return;
      }

      // 'background' or 'inactive'
      if (soundEngine.getState().status !== 'listening') return;
      if (settings.backgroundListening) return;
      autoPaused.current = true;
      soundEngine.stop();
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [settings.backgroundListening]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        // Edge-to-edge is enabled on Android, so the bottom inset is added
        // explicitly rather than relying on the default chrome height.
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopColor: c.tabBarBorder,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="listen"
        options={{
          title: 'Listen',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'pulse' : 'pulse-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'time' : 'time-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="circle"
        options={{
          title: 'Circle',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
