import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, StatusBar, Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  withSequence, Easing, interpolate, cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '@/constants/Colors';
import { useSoundRecognition, type ThreatLevel } from '@/hooks/useSoundRecognition';

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
const EASING_LINEAR = Easing.linear;

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
    statusText: 'Caution: Sound Detected',
    icon: 'warning',
  },
  critical: {
    color: '#FF3B5C',
    colorDim: 'rgba(255, 59, 92, 0.12)',
    label: 'CRITICAL',
    statusText: 'CRITICAL: Danger Detected',
    icon: 'alert-circle',
  },
};

const CRITICAL_SOS_THRESHOLD_SECONDS = 6; // Auto-trigger SOS after 6s of critical

// ─── Sonar Pulse Ring ────────────────────────────────────────────
function SonarRing({ index, color, duration }: { index: number; color: string; duration: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      index * (duration / RING_COUNT),
      withRepeat(withTiming(1, { duration, easing: EASING_LINEAR }), -1, false)
    );
    return () => cancelAnimation(progress);
  }, [color, duration]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.25, 1.15]) }],
    opacity: interpolate(progress.value, [0, 0.2, 1], [0.6, 0.45, 0]),
    borderColor: color,
  }));
  return (
    <Animated.View style={[styles.sonarRing, { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2 }, animStyle]} />
  );
}

// ─── Radar Blip ──────────────────────────────────────────────────
function RadarBlip({ angle, color, visible }: { angle: number; color: string; visible: boolean }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);
  useEffect(() => {
    if (visible) {
      opacity.value = withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 800 }), withTiming(1, { duration: 400 })), -1, false);
      scale.value = withRepeat(withSequence(withTiming(1.2, { duration: 400 }), withTiming(0.8, { duration: 800 }), withTiming(1.2, { duration: 400 })), -1, false);
    } else {
      opacity.value = withTiming(0, { duration: 300 });
      scale.value = withTiming(0.5, { duration: 300 });
    }
  }, [visible]);
  const radius = RADAR_SIZE * 0.32;
  const x = Math.cos((angle * Math.PI) / 180) * radius;
  const y = Math.sin((angle * Math.PI) / 180) * radius;
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.blip, { left: RADAR_SIZE / 2 + x - 9, top: RADAR_SIZE / 2 + y - 9, backgroundColor: color, shadowColor: color }, animStyle]} />
  );
}

// ─── Sweep Line ──────────────────────────────────────────────────
function SweepLine({ color }: { color: string }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(withTiming(360, { duration: 3000, easing: EASING_LINEAR }), -1, false);
    return () => cancelAnimation(rotation);
  }, [color]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={[styles.sweepContainer, { width: RADAR_SIZE, height: RADAR_SIZE }, animStyle]}>
      <View style={[styles.sweepLine, { backgroundColor: color, width: RADAR_SIZE / 2 - 6, right: RADAR_SIZE / 2 }]} />
    </Animated.View>
  );
}

// ─── Main Radar Screen ──────────────────────────────────────────
export default function RadarScreen() {
  const [level, setLevel] = useState<AlertLevel>('safe');
  const [blipAngle, setBlipAngle] = useState(45);
  const [detectedSound, setDetectedSound] = useState<string | null>(null);
  const [confidenceText, setConfidenceText] = useState<string | null>(null);
  const sosPushedRef = useRef(false);

  // Sound recognition hook
  const recognition = useSoundRecognition();

  const config = LEVEL_CONFIGS[level];
  const statusOpacity = useSharedValue(1);

  // ── React to inference predictions ──
  useEffect(() => {
    if (!recognition.isListening) return;

    const pred = recognition.prediction;
    if (pred) {
      const newLevel = pred.threatLevel as AlertLevel;
      setLevel(newLevel);
      setDetectedSound(pred.label);
      setConfidenceText(`${Math.round(pred.confidence * 100)}% confidence`);
      if (newLevel !== 'safe') {
        setBlipAngle(Math.floor(Math.random() * 360));
      }
      statusOpacity.value = withSequence(
        withTiming(0, { duration: 100 }),
        withTiming(1, { duration: 200 }),
      );
    } else {
      setLevel('safe');
      setDetectedSound(null);
      setConfidenceText(null);
    }
  }, [recognition.prediction]);

  // ── Auto-trigger SOS on sustained critical detection ──
  useEffect(() => {
    if (
      recognition.criticalStreakSeconds >= CRITICAL_SOS_THRESHOLD_SECONDS &&
      !sosPushedRef.current
    ) {
      sosPushedRef.current = true;
      recognition.stopListening();
      router.push('/sos-alert');
    }
  }, [recognition.criticalStreakSeconds]);

  // Reset SOS flag when returning to this screen
  useEffect(() => {
    sosPushedRef.current = false;
  }, []);

  // ── Manual simulation (still available as fallback) ──
  const changeLevel = useCallback((newLevel: AlertLevel) => {
    // Stop live listening when manually simulating
    if (recognition.isListening) recognition.stopListening();

    statusOpacity.value = withSequence(
      withTiming(0, { duration: 150 }),
      withTiming(1, { duration: 300 }),
    );
    if (newLevel === 'warning') {
      setDetectedSound('Car Horn');
      setConfidenceText('Simulated');
      setBlipAngle(Math.floor(Math.random() * 360));
    } else if (newLevel === 'critical') {
      setDetectedSound('Siren');
      setConfidenceText('Simulated');
      setBlipAngle(Math.floor(Math.random() * 360));
    } else {
      setDetectedSound(null);
      setConfidenceText(null);
    }
    setLevel(newLevel);

    if (newLevel === 'critical') {
      setTimeout(() => router.push('/sos-alert'), 600);
    }
  }, [recognition]);

  // ── Toggle live listening ──
  const toggleListening = useCallback(() => {
    if (recognition.isListening) {
      recognition.stopListening();
      setLevel('safe');
      setDetectedSound(null);
      setConfidenceText(null);
    } else {
      sosPushedRef.current = false;
      recognition.startListening();
    }
  }, [recognition]);

  const statusBoxStyle = useAnimatedStyle(() => ({ opacity: statusOpacity.value }));

  // Center dot glow
  const centerGlow = useSharedValue(0.3);
  useEffect(() => {
    centerGlow.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1200, easing: EASING_LINEAR }),
        withTiming(0.3, { duration: 1200, easing: EASING_LINEAR }),
      ), -1, false);
  }, []);
  const centerGlowStyle = useAnimatedStyle(() => ({ opacity: centerGlow.value }));

  // Dynamic status text
  const statusText = detectedSound
    ? `${level === 'critical' ? 'CRITICAL' : 'Caution'}: ${detectedSound} Detected`
    : recognition.isListening
      ? 'Listening to Environment...'
      : 'Monitoring Environment...';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.black} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>SoundGuard</Text>
        <Text style={styles.appSubtitle}>Sound Awareness Radar</Text>
      </View>

      {/* Radar */}
      <View style={styles.radarWrapper}>
        <View style={[styles.radarContainer, { width: RADAR_SIZE, height: RADAR_SIZE }]}>
          <View style={[styles.radarGlow, { backgroundColor: config.colorDim, width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2 }]} />
          {Array.from({ length: STATIC_RING_COUNT }).map((_, i) => {
            const s = 0.33 + i * 0.33;
            const sz = RADAR_SIZE * s;
            return <View key={`g-${i}`} style={[styles.staticRing, { width: sz, height: sz, borderRadius: sz / 2 }]} />;
          })}
          <View style={[styles.crosshairH, { width: RADAR_SIZE - 4 }]} />
          <View style={[styles.crosshairV, { height: RADAR_SIZE - 4 }]} />
          <SweepLine color={config.color} />
          {Array.from({ length: RING_COUNT }).map((_, i) => (
            <SonarRing key={`s-${i}-${level}`} index={i} color={config.color} duration={2400} />
          ))}
          <RadarBlip angle={blipAngle} color={config.color} visible={level !== 'safe'} />
          <Animated.View style={[styles.centerGlow, { backgroundColor: config.color, shadowColor: config.color }, centerGlowStyle]} />
          <View style={[styles.centerDot, { backgroundColor: config.color, shadowColor: config.color }]} />
        </View>
      </View>

      {/* Status Box */}
      <Animated.View style={[styles.statusBox, { borderColor: config.color + '44' }, statusBoxStyle]}>
        <Ionicons name={config.icon} size={24} color={config.color} />
        <View style={styles.statusTextGroup}>
          <View style={styles.statusLabelRow}>
            <Text style={[styles.statusLabel, { color: config.color }]}>{config.label}</Text>
            {confidenceText && <Text style={styles.confidenceBadge}>{confidenceText}</Text>}
          </View>
          <Text style={styles.statusMessage}>{statusText}</Text>
        </View>
      </Animated.View>

      {/* Live Listening Toggle */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.listenButton, recognition.isListening && styles.listenButtonActive]}
          activeOpacity={0.7}
          onPress={toggleListening}
        >
          <Ionicons
            name={recognition.isListening ? 'mic' : 'mic-outline'}
            size={22}
            color={recognition.isListening ? theme.colors.background : theme.colors.accent}
          />
          <Text style={[styles.listenButtonText, recognition.isListening && styles.listenButtonTextActive]}>
            {recognition.isListening ? 'Listening...' : 'Start Live Detection'}
          </Text>
          {recognition.isListening && <View style={styles.listenDot} />}
        </TouchableOpacity>

        {recognition.error && (
          <Text style={styles.errorText}>{recognition.error}</Text>
        )}

        {/* Simulation buttons */}
        <Text style={styles.controlsTitle}>SIMULATE</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.simButton, { borderColor: LEVEL_CONFIGS.safe.color }, level === 'safe' && !recognition.isListening && { backgroundColor: LEVEL_CONFIGS.safe.color + '22' }]}
            activeOpacity={0.7} onPress={() => changeLevel('safe')}
          >
            <Ionicons name="shield-checkmark" size={18} color={LEVEL_CONFIGS.safe.color} />
            <Text style={[styles.simButtonText, { color: LEVEL_CONFIGS.safe.color }]}>Safe</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simButton, { borderColor: LEVEL_CONFIGS.warning.color }, level === 'warning' && !recognition.isListening && { backgroundColor: LEVEL_CONFIGS.warning.color + '22' }]}
            activeOpacity={0.7} onPress={() => changeLevel('warning')}
          >
            <Ionicons name="warning" size={18} color={LEVEL_CONFIGS.warning.color} />
            <Text style={[styles.simButtonText, { color: LEVEL_CONFIGS.warning.color }]}>Warning</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simButton, { borderColor: LEVEL_CONFIGS.critical.color }, level === 'critical' && !recognition.isListening && { backgroundColor: LEVEL_CONFIGS.critical.color + '22' }]}
            activeOpacity={0.7} onPress={() => changeLevel('critical')}
          >
            <Ionicons name="alert-circle" size={18} color={LEVEL_CONFIGS.critical.color} />
            <Text style={[styles.simButtonText, { color: LEVEL_CONFIGS.critical.color }]}>Critical</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingTop: 20, paddingBottom: 8, alignItems: 'center' },
  appTitle: { fontSize: 28, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  appSubtitle: { fontSize: 14, color: theme.colors.textSecondary, marginTop: 4 },
  radarWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  radarContainer: { justifyContent: 'center', alignItems: 'center' },
  radarGlow: { position: 'absolute' },
  staticRing: { position: 'absolute', borderWidth: 1, borderColor: theme.colors.border },
  crosshairH: { position: 'absolute', height: 1, backgroundColor: theme.colors.border, opacity: 0.4 },
  crosshairV: { position: 'absolute', width: 1, backgroundColor: theme.colors.border, opacity: 0.4 },
  sonarRing: { position: 'absolute', borderWidth: 2 },
  sweepContainer: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  sweepLine: { position: 'absolute', height: 2, opacity: 0.45, borderRadius: 1 },
  blip: { position: 'absolute', width: 18, height: 18, borderRadius: 9, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 10, elevation: 6 },
  centerGlow: { position: 'absolute', width: 44, height: 44, borderRadius: 22, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 4 },
  centerDot: { width: 14, height: 14, borderRadius: 7, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 12, elevation: 8 },

  statusBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 12, padding: 16, backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, gap: 14 },
  statusTextGroup: { flex: 1 },
  statusLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  confidenceBadge: { fontSize: 11, fontWeight: '600', color: theme.colors.textTertiary, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusMessage: { fontSize: 16, fontWeight: '600', color: theme.colors.text, marginTop: 4, lineHeight: 22 },

  controlsContainer: { paddingHorizontal: 24, paddingBottom: 20 },

  // Live listen button
  listenButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.accent, backgroundColor: theme.colors.surface, marginBottom: 16 },
  listenButtonActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  listenButtonText: { fontSize: 16, fontWeight: '700', color: theme.colors.accent },
  listenButtonTextActive: { color: theme.colors.background },
  listenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.background, opacity: 0.8 },
  errorText: { fontSize: 13, color: theme.colors.urgent, textAlign: 'center', marginBottom: 12 },

  controlsTitle: { fontSize: 11, fontWeight: '700', color: theme.colors.textTertiary, letterSpacing: 1.5, textAlign: 'center', marginBottom: 10 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  simButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, backgroundColor: theme.colors.surface },
  simButtonText: { fontSize: 14, fontWeight: '700' },
});
