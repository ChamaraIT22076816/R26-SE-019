/**
 * SoundGuard — SOS escalation watcher
 * ─────────────────────────────────────────────────────────────────────────────
 * Sustained critical audio escalates to the SOS flow from anywhere in the app,
 * not just the home tab — a user reading Settings when a smoke-alarm-class
 * sound starts must still get the countdown.
 *
 * Guarded on three axes so it can never double-fire or loop:
 *   • the `autoSos` setting must be on
 *   • the SOS route must not already be open
 *   • a latch prevents re-entry until the critical streak has cleared
 */

import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';

import { useEngineActions, useEngineState } from '@/providers/EngineProvider';
import { useSettings } from '@/providers/SettingsProvider';

export function SosWatcher() {
  const { criticalHoldMs } = useEngineState();
  const { settings } = useSettings();
  const { stop } = useEngineActions();
  const pathname = usePathname();

  const latched = useRef(false);

  useEffect(() => {
    const thresholdMs = Math.max(1000, settings.criticalHoldSeconds * 1000);

    // Release the latch once the streak has genuinely ended.
    if (criticalHoldMs === 0) {
      latched.current = false;
      return;
    }

    if (!settings.autoSos) return;
    if (latched.current) return;
    if (criticalHoldMs < thresholdMs) return;
    if (pathname === '/sos-alert') return;

    latched.current = true;
    stop();
    router.push('/sos-alert');
  }, [criticalHoldMs, settings.autoSos, settings.criticalHoldSeconds, pathname, stop]);

  return null;
}
