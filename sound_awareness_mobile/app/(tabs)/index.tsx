import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '@/constants/Colors';

// ─── Types ───────────────────────────────────────────────────────
type AlertLevel = 'safe' | 'warning' | 'critical';

type LevelConfig = {
  color: string;
  colorDim: string;
  label: string;
  statusText: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// ─── Constants ───────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const RADAR_SIZE = Math.min(SCREEN_WIDTH - 80, 300);
const RING_COUNT = 3;
const STATIC_RING_COUNT = 3;

const LEVEL_CONFIGS: Record<AlertLevel, LevelConfig> = {
  safe: {
    color: '#4DA6FF',
    colorDim: 'rgba(77, 166, 255, 0.12)',
    label: 'SAFE',
    statusText: 'Monitoring Environment...',
    icon: 'shield-checkmark',
  },
  warning: {
    color: '#FFB020',
    colorDim: 'rgba(255, 176, 32, 0.12)',
    label: 'WARNING',
    statusText: 'Caution: Loud Horn Detected',
    icon: 'warning',
  },
  critical: {
    color: '#FF3B5C',
    colorDim: 'rgba(255, 59, 92, 0.12)',
    label: 'CRITICAL',
    statusText: 'CRITICAL: Car Crash Detected',
    icon: 'alert-circle',
  },
};

// Simple linear easing for maximum compatibility
const EASING_LINEAR = Easing.linear;

// ─── Sonar Pulse Ring Component ──────────────────────────────────
function SonarRing({
  index,
  color,
  duration,
}: {
  index: number;
  color: string;
  duration: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      index * (duration / RING_COUNT),
      withRepeat(
        withTiming(1, { duration, easing: EASING_LINEAR }),
        -1,
        false
      )
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [color, duration]);

  const animStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.25, 1.15]);
    const opacity = interpolate(progress.value, [0, 0.2, 1], [0.6, 0.45, 0]);
    return {
      transform: [{ scale }],
      opacity,
      borderColor: color,
    };
  });

  return (
    <Animated.View
      style={[
        styles.sonarRing,
        {
          width: RADAR_SIZE,
          height: RADAR_SIZE,
          borderRadius: RADAR_SIZE / 2,
        },
        animStyle,
      ]}
    />
  );
}

// ─── Radar Blip Component ────────────────────────────────────────
function RadarBlip({
  angle,
  color,
  visible,
}: {
  angle: number;
  color: string;
  visible: boolean;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    if (visible) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 400, easing: EASING_LINEAR }),
          withTiming(0.3, { duration: 800, easing: EASING_LINEAR }),
          withTiming(1, { duration: 400, easing: EASING_LINEAR })
        ),
        -1,
        false
      );
      scale.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 400, easing: EASING_LINEAR }),
          withTiming(0.8, { duration: 800, easing: EASING_LINEAR }),
          withTiming(1.2, { duration: 400, easing: EASING_LINEAR })
        ),
        -1,
        false
      );
    } else {
      opacity.value = withTiming(0, { duration: 300, easing: EASING_LINEAR });
      scale.value = withTiming(0.5, { duration: 300, easing: EASING_LINEAR });
    }
  }, [visible]);

  const radius = RADAR_SIZE * 0.32;
  const x = Math.cos((angle * Math.PI) / 180) * radius;
  const y = Math.sin((angle * Math.PI) / 180) * radius;

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.blip,
        {
          left: RADAR_SIZE / 2 + x - 9,
          top: RADAR_SIZE / 2 + y - 9,
          backgroundColor: color,
          shadowColor: color,
        },
        animStyle,
      ]}
    />
  );
}

// ─── Sweep Line Component ────────────────────────────────────────
function SweepLine({ color }: { color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: EASING_LINEAR }),
      -1,
      false
    );
    return () => {
      cancelAnimation(rotation);
    };
  }, [color]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        styles.sweepContainer,
        { width: RADAR_SIZE, height: RADAR_SIZE },
        animStyle,
      ]}
    >
      <View
        style={[
          styles.sweepLine,
          {
            backgroundColor: color,
            width: RADAR_SIZE / 2 - 6,
            right: RADAR_SIZE / 2,
          },
        ]}
      />
    </Animated.View>
  );
}

// ─── Main Radar Screen ──────────────────────────────────────────
export default function RadarScreen() {
  const [level, setLevel] = useState<AlertLevel>('safe');
  const [blipAngle, setBlipAngle] = useState(45);

  const config = LEVEL_CONFIGS[level];

  // Status box fade transition
  const statusOpacity = useSharedValue(1);

  const changeLevel = useCallback((newLevel: AlertLevel) => {
    statusOpacity.value = withSequence(
      withTiming(0, { duration: 150, easing: EASING_LINEAR }),
      withTiming(1, { duration: 300, easing: EASING_LINEAR })
    );
    if (newLevel === 'warning' || newLevel === 'critical') {
      setBlipAngle(Math.floor(Math.random() * 360));
    }
    setLevel(newLevel);

    // Trigger SOS modal on critical
    if (newLevel === 'critical') {
      setTimeout(() => {
        router.push('/sos-alert');
      }, 600);
    }
  }, []);

  const statusBoxStyle = useAnimatedStyle(() => ({
    opacity: statusOpacity.value,
  }));

  // Center dot glow pulse
  const centerGlow = useSharedValue(0.3);
  useEffect(() => {
    centerGlow.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1200, easing: EASING_LINEAR }),
        withTiming(0.3, { duration: 1200, easing: EASING_LINEAR })
      ),
      -1,
      false
    );
  }, []);

  const centerGlowStyle = useAnimatedStyle(() => ({
    opacity: centerGlow.value,
  }));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.black} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>SoundGuard</Text>
        <Text style={styles.appSubtitle}>Sound Awareness Radar</Text>
      </View>

      {/* ── Radar Visualization ── */}
      <View style={styles.radarWrapper}>
        <View
          style={[
            styles.radarContainer,
            { width: RADAR_SIZE, height: RADAR_SIZE },
          ]}
        >
          {/* Background glow disc */}
          <View
            style={[
              styles.radarGlow,
              {
                backgroundColor: config.colorDim,
                width: RADAR_SIZE,
                height: RADAR_SIZE,
                borderRadius: RADAR_SIZE / 2,
              },
            ]}
          />

          {/* Static concentric guide rings */}
          {Array.from({ length: STATIC_RING_COUNT }).map((_, i) => {
            const scale = 0.33 + i * 0.33;
            const size = RADAR_SIZE * scale;
            return (
              <View
                key={`guide-${i}`}
                style={[
                  styles.staticRing,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                  },
                ]}
              />
            );
          })}

          {/* Crosshair lines */}
          <View style={[styles.crosshairH, { width: RADAR_SIZE - 4 }]} />
          <View style={[styles.crosshairV, { height: RADAR_SIZE - 4 }]} />

          {/* Rotating sweep line */}
          <SweepLine color={config.color} />

          {/* Expanding sonar pulse rings */}
          {Array.from({ length: RING_COUNT }).map((_, i) => (
            <SonarRing
              key={`sonar-${i}-${level}`}
              index={i}
              color={config.color}
              duration={2400}
            />
          ))}

          {/* Blip — only for warning / critical */}
          <RadarBlip
            angle={blipAngle}
            color={config.color}
            visible={level !== 'safe'}
          />

          {/* Center glow halo */}
          <Animated.View
            style={[
              styles.centerGlow,
              {
                backgroundColor: config.color,
                shadowColor: config.color,
              },
              centerGlowStyle,
            ]}
          />
          {/* Center dot */}
          <View
            style={[
              styles.centerDot,
              {
                backgroundColor: config.color,
                shadowColor: config.color,
              },
            ]}
          />
        </View>
      </View>

      {/* ── Status Text Box ── */}
      <Animated.View
        style={[
          styles.statusBox,
          { borderColor: config.color + '44' },
          statusBoxStyle,
        ]}
      >
        <Ionicons name={config.icon} size={24} color={config.color} />
        <View style={styles.statusTextGroup}>
          <Text style={[styles.statusLabel, { color: config.color }]}>
            {config.label}
          </Text>
          <Text style={styles.statusMessage}>{config.statusText}</Text>
        </View>
      </Animated.View>

      {/* ── Simulation Buttons ── */}
      <View style={styles.controlsContainer}>
        <Text style={styles.controlsTitle}>SIMULATE</Text>
        <View style={styles.buttonRow}>
          {/* Safe */}
          <TouchableOpacity
            style={[
              styles.simButton,
              { borderColor: LEVEL_CONFIGS.safe.color },
              level === 'safe' && {
                backgroundColor: LEVEL_CONFIGS.safe.color + '22',
              },
            ]}
            activeOpacity={0.7}
            onPress={() => changeLevel('safe')}
          >
            <Ionicons
              name="shield-checkmark"
              size={18}
              color={LEVEL_CONFIGS.safe.color}
            />
            <Text
              style={[
                styles.simButtonText,
                { color: LEVEL_CONFIGS.safe.color },
              ]}
            >
              Safe
            </Text>
          </TouchableOpacity>

          {/* Warning */}
          <TouchableOpacity
            style={[
              styles.simButton,
              { borderColor: LEVEL_CONFIGS.warning.color },
              level === 'warning' && {
                backgroundColor: LEVEL_CONFIGS.warning.color + '22',
              },
            ]}
            activeOpacity={0.7}
            onPress={() => changeLevel('warning')}
          >
            <Ionicons
              name="warning"
              size={18}
              color={LEVEL_CONFIGS.warning.color}
            />
            <Text
              style={[
                styles.simButtonText,
                { color: LEVEL_CONFIGS.warning.color },
              ]}
            >
              Warning
            </Text>
          </TouchableOpacity>

          {/* Critical */}
          <TouchableOpacity
            style={[
              styles.simButton,
              { borderColor: LEVEL_CONFIGS.critical.color },
              level === 'critical' && {
                backgroundColor: LEVEL_CONFIGS.critical.color + '22',
              },
            ]}
            activeOpacity={0.7}
            onPress={() => changeLevel('critical')}
          >
            <Ionicons
              name="alert-circle"
              size={18}
              color={LEVEL_CONFIGS.critical.color}
            />
            <Text
              style={[
                styles.simButtonText,
                { color: LEVEL_CONFIGS.critical.color },
              ]}
            >
              Critical
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  /* Header */
  header: {
    paddingTop: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },

  /* Radar area */
  radarWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarGlow: {
    position: 'absolute',
  },
  staticRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    backgroundColor: theme.colors.border,
    opacity: 0.4,
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    backgroundColor: theme.colors.border,
    opacity: 0.4,
  },
  sonarRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  sweepContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sweepLine: {
    position: 'absolute',
    height: 2,
    opacity: 0.45,
    borderRadius: 1,
  },
  blip: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  centerGlow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 4,
  },
  centerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 8,
  },

  /* Status box */
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
  },
  statusTextGroup: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  statusMessage: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: 4,
    lineHeight: 22,
  },

  /* Simulation controls */
  controlsContainer: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  controlsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textTertiary,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: theme.colors.surface,
  },
  simButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
