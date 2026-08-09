/**
 * SoundGuard — Engine binding
 * ─────────────────────────────────────────────────────────────────────────────
 * Connects the framework-free `soundEngine` singleton to React.
 *
 * Three deliberate choices keep the UI in lockstep with the pipeline:
 *
 *   1. `useSyncExternalStore` over the engine's immutable snapshot. The engine
 *      only notifies when a value genuinely changed, so a render is scheduled
 *      for real transitions and never for the ~1 Hz steady-state churn.
 *
 *   2. Actions are a frozen, stable object. Nothing downstream re-renders
 *      because a callback identity moved, and dependency arrays stay honest.
 *
 *   3. The audio level meter never touches React state. It is pushed straight
 *      into a Reanimated shared value at ~4 Hz and animated on the UI thread,
 *      so a live visualiser costs zero renders and zero JS-thread work per
 *      frame.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { soundEngine, type EngineEvent, type EngineState } from '@/utils/soundEngine';
import type { SoundLabel } from '@/utils/storage';
import { useSettings } from './SettingsProvider';

export type EngineActions = {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  dismiss: () => void;
  undoDismiss: () => void;
  reset: () => void;
  simulate: (label: SoundLabel) => void;
  /** Subscribe to one-shot events (detection, dismissal, reset). */
  onEvent: (listener: (e: EngineEvent) => void) => () => void;
};

type EngineContextValue = {
  actions: EngineActions;
  /** 0…1 microphone level, animated on the UI thread. */
  level: SharedValue<number>;
};

const noop = () => {};

const FALLBACK_CONTEXT: EngineContextValue = {
  actions: {
    start: noop,
    stop: noop,
    toggle: noop,
    dismiss: noop,
    undoDismiss: noop,
    reset: noop,
    simulate: noop,
    onEvent: () => noop,
  },
  // Replaced by the provider; never read before it mounts.
  level: { value: 0 } as SharedValue<number>,
};

const EngineContext = createContext<EngineContextValue>(FALLBACK_CONTEXT);

export function EngineProvider({ children }: PropsWithChildren) {
  const { settings, ready } = useSettings();
  const level = useSharedValue(0);

  /** True when we paused capture ourselves because the app was backgrounded. */
  const autoPaused = useRef(false);

  // ── Level meter: engine → shared value, bypassing React entirely ──
  useEffect(() => {
    soundEngine.onLevel = (value: number) => {
      level.value = withTiming(value, { duration: 160 });
    };
    return () => {
      soundEngine.onLevel = null;
    };
  }, [level]);

  // ── Push settings into the engine the moment they change ──
  useEffect(() => {
    if (!ready) return;
    soundEngine.setSettings(settings);
  }, [settings, ready]);

  // ── Warm the ONNX session while the user is still reading the home screen ──
  useEffect(() => {
    void soundEngine.loadModel();
  }, []);

  // ── Background behaviour, driven by the `backgroundListening` setting ──
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const listening = soundEngine.getState().status === 'listening';

      if (next === 'active') {
        if (autoPaused.current) {
          autoPaused.current = false;
          void soundEngine.start();
        }
        return;
      }

      // 'background' or 'inactive'
      if (listening && !settings.backgroundListening) {
        autoPaused.current = true;
        soundEngine.stop();
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [settings.backgroundListening]);

  const value = useMemo<EngineContextValue>(
    () => ({
      level,
      actions: Object.freeze({
        start: () => {
          void soundEngine.start();
        },
        stop: () => soundEngine.stop(),
        toggle: () => {
          void soundEngine.toggle();
        },
        dismiss: () => soundEngine.dismiss(),
        undoDismiss: () => soundEngine.undoDismiss(),
        reset: () => soundEngine.reset(),
        simulate: (label: SoundLabel) => soundEngine.simulate(label),
        onEvent: (listener: (e: EngineEvent) => void) => soundEngine.onEvent(listener),
      }),
    }),
    [level],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

/** Reactive engine state. Re-renders only when a published value changes. */
export function useEngineState(): EngineState {
  return useSyncExternalStore(
    soundEngine.subscribe,
    soundEngine.getState,
    soundEngine.getState,
  );
}

/** Stable action handles. Safe in any dependency array. */
export function useEngineActions(): EngineActions {
  return useContext(EngineContext).actions;
}

/** Live microphone level as a Reanimated shared value (UI thread). */
export function useAudioLevel(): SharedValue<number> {
  return useContext(EngineContext).level;
}
