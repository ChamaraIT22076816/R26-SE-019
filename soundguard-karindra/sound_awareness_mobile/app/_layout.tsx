/**
 * SoundGuard — Root layout
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider order matters:
 *
 *   SettingsProvider → ThemeProvider → EngineProvider
 *
 * Theme reads `themeMode` from settings, and the engine reads sensitivity,
 * haptics and background behaviour from the same object. Settings must
 * therefore hydrate first; the splash screen is held until it has, so no screen
 * ever renders with default values and then snaps to the user's real
 * preferences.
 */

import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  type Theme,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { FlashOverlay } from '@/components/FlashOverlay';
import { Onboarding } from '@/components/Onboarding';
import { SosWatcher } from '@/components/SosWatcher';
import { EngineProvider } from '@/providers/EngineProvider';
import { SettingsProvider, useSettings } from '@/providers/SettingsProvider';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <ThemeProvider>
            <EngineProvider>
              <AppShell />
            </EngineProvider>
          </ThemeProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const { settings, ready } = useSettings();
  const { colors, scheme } = useTheme();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  const navigationTheme = useMemo<Theme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: scheme === 'dark',
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.bg,
        card: colors.bgElevated,
        text: colors.text,
        border: colors.border,
        notification: colors.critical,
      },
    };
  }, [colors, scheme]);

  // Hold a themed blank canvas rather than rendering the app with defaults.
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="sos-alert"
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade',
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>

      {/* Global, route-independent behaviour. */}
      <SosWatcher />
      <FlashOverlay />

      {settings.onboardingComplete ? null : <Onboarding />}
    </NavigationThemeProvider>
  );
}
