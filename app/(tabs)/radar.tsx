import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/Colors';

export default function RadarScreen() {
  // Pulse animation for the radar ring
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.6,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.6,
            duration: 2000,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.black} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>SoundGuard</Text>
        <Text style={styles.appSubtitle}>Sound Awareness Radar</Text>
      </View>

      {/* Radar Visualization */}
      <View style={styles.radarContainer}>
        {/* Outer pulse ring */}
        <Animated.View
          style={[
            styles.radarRingOuter,
            {
              transform: [{ scale: pulseAnim }],
              opacity: opacityAnim,
            },
          ]}
        />
        {/* Middle ring */}
        <View style={styles.radarRingMiddle} />
        {/* Inner ring */}
        <View style={styles.radarRingInner} />
        {/* Center icon */}
        <View style={styles.radarCenter}>
          <Ionicons name="ear-outline" size={48} color={theme.colors.accent} />
          <Text style={styles.listeningText}>Listening...</Text>
        </View>
      </View>

      {/* Status Cards */}
      <View style={styles.statusRow}>
        <View style={styles.statusCard}>
          <Ionicons name="volume-high-outline" size={22} color={theme.colors.accent} />
          <Text style={styles.statusLabel}>Ambient</Text>
          <Text style={styles.statusValue}>32 dB</Text>
        </View>
        <View style={styles.statusCard}>
          <Ionicons name="notifications-outline" size={22} color={theme.colors.accent} />
          <Text style={styles.statusLabel}>Alerts</Text>
          <Text style={styles.statusValue}>0 Active</Text>
        </View>
        <View style={styles.statusCard}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.accent} />
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={[styles.statusValue, { color: theme.colors.accent }]}>Safe</Text>
        </View>
      </View>

      {/* SOS Button */}
      <TouchableOpacity style={styles.sosButton} activeOpacity={0.8}>
        <View style={styles.sosInner}>
          <Ionicons name="alert-circle" size={32} color={theme.colors.white} />
          <Text style={styles.sosText}>Emergency SOS</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const RADAR_SIZE = 220;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
  },
  header: {
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    alignItems: 'center',
  },
  appTitle: {
    fontSize: theme.fontSizes.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: theme.fontSizes.md,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  radarContainer: {
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: theme.spacing.xl,
  },
  radarRingOuter: {
    position: 'absolute',
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    borderRadius: RADAR_SIZE / 2,
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  radarRingMiddle: {
    position: 'absolute',
    width: RADAR_SIZE * 0.65,
    height: RADAR_SIZE * 0.65,
    borderRadius: (RADAR_SIZE * 0.65) / 2,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  radarRingInner: {
    position: 'absolute',
    width: RADAR_SIZE * 0.35,
    height: RADAR_SIZE * 0.35,
    borderRadius: (RADAR_SIZE * 0.35) / 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  radarCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningText: {
    fontSize: theme.fontSizes.sm,
    color: theme.colors.accent,
    marginTop: theme.spacing.xs,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  statusCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statusLabel: {
    fontSize: theme.fontSizes.xs,
    color: theme.colors.textTertiary,
    marginTop: theme.spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusValue: {
    fontSize: theme.fontSizes.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  sosButton: {
    marginTop: 'auto',
    marginBottom: theme.spacing.lg,
  },
  sosInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.urgent,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.urgent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sosText: {
    fontSize: theme.fontSizes.lg,
    fontWeight: '800',
    color: theme.colors.white,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
