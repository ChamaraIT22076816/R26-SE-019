import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, StatusBar, useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  withSequence, Easing, interpolate, cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/Colors';
import { useSoundRecognition } from '@/hooks/useSoundRecognition';

// ─── Types ───────────────────────────────────────────────────────
type AlertLevel = 'safe' | 'warning' | 'critical';

type LevelConfig = {
  color: string;
  colorDim: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// ─── Constants ───────────────────────────────────────────────────
const RING_COUNT        = 3;
const STATIC_RING_COUNT = 3;
const EASING_LINEAR     = Easing.linear;

const LEVEL_CONFIGS: Record<AlertLevel, LevelConfig> = {
  safe: {
    color:    '#4DA6FF',
    colorDim: 'rgba(77, 166, 255, 0.12)',
    label:    'SAFE',
    icon:     'shield-checkmark',
  },
  warning: {
    color:    '#FFB020',
    colorDim: 'rgba(255, 176, 32, 0.12)',
    label:    'WARNING',
    icon:     'warning',
  },
  critical: {
    color:    '#FF3B5C',
    colorDim: 'rgba(255, 59, 92, 0.12)',
    label:    'CRITICAL',
    icon:     'alert-circle',
  },
};

const CRITICAL_SOS_THRESHOLD_SECONDS = 6;

// ─── Sonar Pulse Ring ────────────────────────────────────────────
function SonarRing({
  index, color, duration, radarSize,
}: { index: number; color: string; duration: number; radarSize: number }) {
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
    transform:   [{ scale: interpolate(progress.value, [0, 1], [0.25, 1.15]) }],
    opacity:     interpolate(progress.value, [0, 0.2, 1], [0.6, 0.45, 0]),
    borderColor: color,
  }));
  return (
    <Animated.View
      style={[
        styles.sonarRing,
        { width: radarSize, height: radarSize, borderRadius: radarSize / 2 },
        animStyle,
      ]}
    />
  );
}

// ─── Radar Blip ──────────────────────────────────────────────────
function RadarBlip({
  angle, color, visible, radarSize,
}: { angle: number; color: string; visible: boolean; radarSize: number }) {
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.5);
  useEffect(() => {
    if (visible) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1,   { duration: 400 }),
          withTiming(0.3, { duration: 800 }),
          withTiming(1,   { duration: 400 }),
        ), -1, false);
      scale.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 400 }),
          withTiming(0.8, { duration: 800 }),
          withTiming(1.2, { duration: 400 }),
        ), -1, false);
    } else {
      opacity.value = withTiming(0,   { duration: 300 });
      scale.value   = withTiming(0.5, { duration: 300 });
    }
  }, [visible]);
  const radius = radarSize * 0.32;
  const x = Math.cos((angle * Math.PI) / 180) * radius;
  const y = Math.sin((angle * Math.PI) / 180) * radius;
  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        styles.blip,
        {
          left:            radarSize / 2 + x - 9,
          top:             radarSize / 2 + y - 9,
          backgroundColor: color,
          shadowColor:     color,
        },
        animStyle,
      ]}
    />
  );
}

// ─── Sweep Line ──────────────────────────────────────────────────
function SweepLine({ color, radarSize }: { color: string; radarSize: number }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: EASING_LINEAR }), -1, false
    );
    return () => cancelAnimation(rotation);
  }, [color]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <Animated.View
      style={[styles.sweepContainer, { width: radarSize, height: radarSize }, animStyle]}
    >
      <View
        style={[
          styles.sweepLine,
          { backgroundColor: color, width: radarSize / 2 - 6, right: radarSize / 2 },
        ]}
      />
    </Animated.View>
  );
}

// ─── Main Radar Screen ──────────────────────────────────────────
export default function RadarScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * Responsive radar size.
   *
   * availableHeight = screen height
   *   − insets.top   (status bar / notch)
   *   − insets.bottom (home indicator)
   *   − header height  ≈ 54 px
   *   − status box     ≈ 72 px
   *   − controls area  ≈ 150 px  (listen button + simulate strip)
   *   − tab bar        ≈ 56 px
   *   − vertical margins ≈ 36 px
   *
   * The floor of 180 prevents the radar from collapsing to nothing on very
   * small screens (e.g. 4.7″ iPhone-class display).
   */
  const availableHeight = screenHeight - insets.top - insets.bottom - 368;
  const radarSize = Math.max(180, Math.min(screenWidth - 64, 300, availableHeight));

  const [level, setLevel]                 = useState<AlertLevel>('safe');
  const [blipAngle, setBlipAngle]         = useState(45);
  const [detectedSound, setDetectedSound] = useState<string | null>(null);
  const [confidenceText, setConfidenceText] = useState<string | null>(null);
  const sosPushedRef = useRef(false);

  const recognition   = useSoundRecognition();
  const config        = LEVEL_CONFIGS[level];
  const statusOpacity = useSharedValue(1);

  // ── React to inference predictions ──
  useEffect(() => {
    if (!recognition.isListening) return;
    const pred = recognition.prediction;
    if (pred) {
      const newLevel = pred.threatLevel as AlertLevel;
      setLevel(newLevel);
      setDetectedSound(pred.label);
      setConfidenceText(`${Math.round(pred.confidence * 100)}% conf`);
      if (newLevel !== 'safe') setBlipAngle(Math.floor(Math.random() * 360));
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

  // Reset SOS flag when screen mounts
  useEffect(() => { sosPushedRef.current = false; }, []);

  // ── Manual simulation ──
  const changeLevel = useCallback((newLevel: AlertLevel) => {
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

  const statusBoxStyle  = useAnimatedStyle(() => ({ opacity: statusOpacity.value }));

  const centerGlow = useSharedValue(0.3);
  useEffect(() => {
    centerGlow.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1200, easing: EASING_LINEAR }),
        withTiming(0.3, { duration: 1200, easing: EASING_LINEAR }),
      ), -1, false);
  }, []);
  const centerGlowStyle = useAnimatedStyle(() => ({ opacity: centerGlow.value }));

  const statusText = detectedSound
    ? `${level === 'critical' ? 'CRITICAL' : 'Caution'}: ${detectedSound} Detected`
    : recognition.isListening
      ? 'Listening to Environment...'
      : 'Tap below to start monitoring';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.black} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>SoundGuard</Text>
        <Text style={styles.appSubtitle}>Sound Awareness Radar</Text>
      </View>

      {/* ── Radar (flex: 1 fills remaining vertical space) ── */}
      <View style={styles.radarWrapper}>
        <View style={[styles.radarContainer, { width: radarSize, height: radarSize }]}>
          {/* Ambient glow */}
          <View
            style={[
              styles.radarGlow,
              { backgroundColor: config.colorDim, width: radarSize, height: radarSize, borderRadius: radarSize / 2 },
            ]}
          />
          {/* Static range rings */}
          {Array.from({ length: STATIC_RING_COUNT }).map((_, i) => {
            const s  = 0.33 + i * 0.33;
            const sz = radarSize * s;
            return (
              <View
                key={`g-${i}`}
                style={[styles.staticRing, { width: sz, height: sz, borderRadius: sz / 2 }]}
              />
            );
          })}
          {/* Crosshairs */}
          <View style={[styles.crosshairH, { width: radarSize - 4 }]} />
          <View style={[styles.crosshairV, { height: radarSize - 4 }]} />
          {/* Sweep line */}
          <SweepLine color={config.color} radarSize={radarSize} />
          {/* Sonar pulse rings */}
          {Array.from({ length: RING_COUNT }).map((_, i) => (
            <SonarRing
              key={`s-${i}-${level}`}
              index={i}
              color={config.color}
              duration={2400}
              radarSize={radarSize}
            />
          ))}
          {/* Threat blip */}
          <RadarBlip
            angle={blipAngle}
            color={config.color}
            visible={level !== 'safe'}
            radarSize={radarSize}
          />
          {/* Center glow + dot */}
          <Animated.View
            style={[
              styles.centerGlow,
              { backgroundColor: config.color, shadowColor: config.color },
              centerGlowStyle,
            ]}
          />
          <View style={[styles.centerDot, { backgroundColor: config.color, shadowColor: config.color }]} />
        </View>
      </View>

      {/* ── Status Box ── */}
      <Animated.View
        style={[styles.statusBox, { borderColor: config.color + '44' }, statusBoxStyle]}
      >
        <Ionicons name={config.icon} size={24} color={config.color} />
        <View style={styles.statusTextGroup}>
          <View style={styles.statusLabelRow}>
            <Text style={[styles.statusLabel, { color: config.color }]}>{config.label}</Text>
            {confidenceText && (
              <Text style={styles.confidenceBadge}>{confidenceText}</Text>
            )}
          </View>
          <Text style={styles.statusMessage} numberOfLines={1}>{statusText}</Text>
        </View>
      </Animated.View>

      {/* ── Controls — safe-area-aware bottom padding ── */}
      <View style={[styles.controlsContainer, { paddingBottom: Math.max(insets.bottom + 16, 20) }]}>
        {/* Live listen button */}
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
          <Text
            style={[
              styles.listenButtonText,
              recognition.isListening && styles.listenButtonTextActive,
            ]}
          >
            {recognition.isListening ? 'Listening...' : 'Start Live Detection'}
          </Text>
          {recognition.isListening && <View style={styles.listenDot} />}
        </TouchableOpacity>

        {/* Model/permission error */}
        {recognition.error && (
          <Text style={styles.errorText} numberOfLines={2}>{recognition.error}</Text>
        )}

        {/* Simulate strip */}
        <Text style={styles.controlsTitle}>SIMULATE</Text>
        <View style={styles.buttonRow}>
          {(['safe', 'warning', 'critical'] as AlertLevel[]).map((lvl) => {
            const lc       = LEVEL_CONFIGS[lvl];
            const isActive = level === lvl && !recognition.isListening;
            return (
              <TouchableOpacity
                key={lvl}
                style={[
                  styles.simButton,
                  { borderColor: lc.color },
                  isActive && { backgroundColor: lc.color + '22' },
                ]}
                activeOpacity={0.7}
                onPress={() => changeLevel(lvl)}
              >
                <Ionicons name={lc.icon} size={18} color={lc.color} />
                <Text style={[styles.simButtonText, { color: lc.color }]}>
                  {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Root — flex: 1 + paddingTop from insets fills the whole screen correctly
  container:      { flex: 1, backgroundColor: theme.colors.background },

  // Compact header — does not have hardcoded paddingTop (supplied by insets above)
  header:         { paddingTop: 8, paddingBottom: 6, alignItems: 'center' },
  appTitle:       { fontSize: 26, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  appSubtitle:    { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },

  // Radar wrapper grows to fill whatever space is between header and status box
  radarWrapper:   { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 180 },
  radarContainer: { justifyContent: 'center', alignItems: 'center' },
  radarGlow:      { position: 'absolute' },
  staticRing:     { position: 'absolute', borderWidth: 1, borderColor: theme.colors.border },
  crosshairH:     { position: 'absolute', height: 1, backgroundColor: theme.colors.border, opacity: 0.4 },
  crosshairV:     { position: 'absolute', width: 1, backgroundColor: theme.colors.border, opacity: 0.4 },
  sonarRing:      { position: 'absolute', borderWidth: 2 },
  sweepContainer: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  sweepLine:      { position: 'absolute', height: 2, opacity: 0.45, borderRadius: 1 },
  blip: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 10, elevation: 6,
  },
  centerGlow: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 4,
  },
  centerDot: {
    width: 14, height: 14, borderRadius: 7,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 12, elevation: 8,
  },

  // Status box — fixed height, sits between radar and controls
  statusBox: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 10, padding: 14,
    backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, gap: 12,
  },
  statusTextGroup: { flex: 1 },
  statusLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel:     { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  confidenceBadge: {
    fontSize: 10, fontWeight: '600', color: theme.colors.textTertiary,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
  },
  statusMessage: { fontSize: 15, fontWeight: '600', color: theme.colors.text, marginTop: 3, lineHeight: 20 },

  // Controls — horizontally padded; bottom padding supplied dynamically from insets
  controlsContainer: { paddingHorizontal: 20 },

  listenButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 15, borderRadius: 14, borderWidth: 1.5,
    borderColor: theme.colors.accent, backgroundColor: theme.colors.surface, marginBottom: 14,
  },
  listenButtonActive:     { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  listenButtonText:       { fontSize: 16, fontWeight: '700', color: theme.colors.accent },
  listenButtonTextActive: { color: theme.colors.background },
  listenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.background, opacity: 0.8 },
  errorText: {
    fontSize: 12, color: theme.colors.urgent, textAlign: 'center',
    marginBottom: 10, lineHeight: 18,
  },

  controlsTitle: {
    fontSize: 10, fontWeight: '700', color: theme.colors.textTertiary,
    letterSpacing: 1.5, textAlign: 'center', marginBottom: 8,
  },
  buttonRow:     { flexDirection: 'row', gap: 8 },
  simButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 13, borderRadius: 12, borderWidth: 1.5,
    backgroundColor: theme.colors.surface,
  },
  simButtonText: { fontSize: 13, fontWeight: '700' },
});
