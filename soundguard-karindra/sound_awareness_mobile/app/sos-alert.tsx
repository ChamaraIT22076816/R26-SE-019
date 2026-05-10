import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Dimensions, Platform, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence,
  withDelay, Easing, interpolate, interpolateColor, cancelAnimation, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { getContacts } from '@/utils/storage';
import type { EmergencyContact } from '@/utils/storage';

// ─── Constants ───────────────────────────────────────────────────
const { width: SW } = Dimensions.get('window');
const SLIDER_TRACK_WIDTH = SW - 80;
const SLIDER_THUMB = 64;
const SLIDER_PAD = 4;
const SLIDER_MAX = SLIDER_TRACK_WIDTH - SLIDER_THUMB - SLIDER_PAD * 2;
const CANCEL_THRESH = 0.85;
const SOS_COUNTDOWN = 10;

const RED_ABYSS = '#0D0204';
const RED_DEEP = '#1A0408';
const RED_CORE = '#6B0F1A';
const RED_HOT = '#CC2244';
const RED_BRIGHT = '#FF2D55';
const RED_GLOW = '#FF4D6A';

// ─── Haptic helper ───────────────────────────────────────────────
function triggerHaptic(t: 'heavy' | 'warning' | 'success' | 'error') {
  try {
    if (Platform.OS === 'web') return;
    if (t === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (t === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (t === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {}
}

// ─── Pulse Ring ──────────────────────────────────────────────────
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, []);
  const s = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 1], [0.3, 1.5]) }],
    opacity: interpolate(p.value, [0, 0.15, 0.6, 1], [0.5, 0.35, 0.12, 0]),
  }));
  return <Animated.View style={[styles.pulseRing, { width: size, height: size, borderRadius: size / 2 }, s]} />;
}

// ─── Countdown Glow Ring ─────────────────────────────────────────
function CountdownGlowRing() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withRepeat(withSequence(
      withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) }),
    ), -1, false);
    return () => cancelAnimation(p);
  }, []);
  const s = useAnimatedStyle(() => ({ borderColor: RED_BRIGHT, opacity: interpolate(p.value, [0, 1], [0.15, 0.5]) }));
  return <Animated.View style={[{ position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 3 }, s]} />;
}

// ─── Transmitting Spinner ────────────────────────────────────────
function TransmittingSpinner() {
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withSequence(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }),
    ), -1, false);
    return () => { cancelAnimation(rotation); cancelAnimation(pulse); };
  }, []);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
    opacity: pulse.value,
  }));
  return (
    <View style={styles.spinnerContainer}>
      <Animated.View style={[styles.spinnerRingOuter, ringStyle]} />
      <View style={styles.spinnerInner}>
        <Ionicons name="radio-outline" size={36} color="#FFB020" />
      </View>
    </View>
  );
}

// ─── Slide-to-Cancel ─────────────────────────────────────────────
function SlideToCancel({ onCancel }: { onCancel: () => void }) {
  const tx = useSharedValue(0);
  const cr = useSharedValue(0);
  const done = useSharedValue(false);
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(shimmer);
  }, []);
  const fire = useCallback(() => onCancel(), [onCancel]);
  const pan = Gesture.Pan().activeOffsetX(5)
    .onUpdate((e) => { if (done.value) return; const x = Math.max(0, Math.min(e.translationX, SLIDER_MAX)); tx.value = x; cr.value = x / SLIDER_MAX; })
    .onEnd(() => { if (done.value) return; if (cr.value > CANCEL_THRESH) { done.value = true; tx.value = withTiming(SLIDER_MAX, { duration: 120 }); runOnJS(fire)(); } else { tx.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) }); cr.value = withTiming(0, { duration: 350 }); } });
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const textFade = useAnimatedStyle(() => ({ opacity: interpolate(cr.value, [0, 0.4], [1, 0]) }));
  const fill = useAnimatedStyle(() => ({ width: tx.value + SLIDER_THUMB + SLIDER_PAD, backgroundColor: interpolateColor(cr.value, [0, 0.5, 1], ['rgba(255,45,85,0.15)', 'rgba(255,45,85,0.3)', 'rgba(255,45,85,0.5)']) }));
  const c1 = useAnimatedStyle(() => ({ opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.6, 0.2, 0.2]) }));
  const c2 = useAnimatedStyle(() => ({ opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.2, 0.6, 0.2]) }));
  const c3 = useAnimatedStyle(() => ({ opacity: interpolate(shimmer.value, [0, 0.33, 0.66, 1], [0.2, 0.2, 0.2, 0.6]) }));
  return (
    <View style={styles.sliderTrack}>
      <Animated.View style={[styles.sliderFill, fill]} />
      <Animated.View style={[styles.sliderTextContainer, textFade]}>
        <Animated.View style={c1}><Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" /></Animated.View>
        <Animated.View style={c2}><Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" /></Animated.View>
        <Text style={styles.sliderLabel}>Slide to Cancel</Text>
        <Animated.View style={c3}><Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" /></Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan}><Animated.View style={[styles.sliderThumb, thumb]}><Ionicons name="close" size={28} color={RED_DEEP} /></Animated.View></GestureDetector>
    </View>
  );
}

// ─── SOS State Machine ──────────────────────────────────────────
type Phase = 'countdown' | 'transmitting' | 'sent' | 'cancelled';

export default function SOSAlertScreen() {
  const [countdown, setCountdown] = useState(SOS_COUNTDOWN);
  const [phase, setPhase] = useState<Phase>('countdown');
  const [statusMsg, setStatusMsg] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bgPulse = useSharedValue(0);
  const bgFlash = useSharedValue(0);
  const toastOpacity = useSharedValue(0);
  const toastSlideY = useSharedValue(20);
  const contentFadeIn = useSharedValue(0);

  // ── Entry fade-in ──
  useEffect(() => { contentFadeIn.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }); }, []);

  // ── Background pulse ──
  useEffect(() => {
    bgPulse.value = withRepeat(withSequence(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
    ), -1, false);
    bgFlash.value = withRepeat(withSequence(
      withTiming(1, { duration: 150, easing: Easing.linear }),
      withTiming(0, { duration: 150, easing: Easing.linear }),
      withTiming(0, { duration: 500, easing: Easing.linear }),
    ), -1, false);
    return () => { cancelAnimation(bgPulse); cancelAnimation(bgFlash); };
  }, []);

  const bgStyle = useAnimatedStyle(() => ({ opacity: interpolate(bgPulse.value, [0, 1], [0.15, 0.45]) }));
  const bgFlashStyle = useAnimatedStyle(() => ({ opacity: interpolate(bgFlash.value, [0, 1], [0, 0.08]) }));
  const contentFade = useAnimatedStyle(() => ({ opacity: contentFadeIn.value, transform: [{ translateY: interpolate(contentFadeIn.value, [0, 1], [30, 0]) }] }));

  // ── Haptic loop ──
  useEffect(() => {
    if (phase !== 'countdown') return;
    triggerHaptic('error');
    const b = setTimeout(() => triggerHaptic('heavy'), 200);
    hapticRef.current = setInterval(() => triggerHaptic('heavy'), 800);
    return () => { clearTimeout(b); if (hapticRef.current) clearInterval(hapticRef.current); };
  }, [phase]);

  // ── Countdown ──
  useEffect(() => {
    if (phase !== 'countdown') return;
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          if (hapticRef.current) clearInterval(hapticRef.current);
          setPhase('transmitting');
          return 0;
        }
        if (prev <= 4) triggerHaptic('error'); else triggerHaptic('warning');
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [phase]);

  // ── Transmitting phase — fetch location, contacts, send SMS ──
  useEffect(() => {
    if (phase !== 'transmitting') return;
    // Calm the background down to an amber pulse
    cancelAnimation(bgFlash);
    bgFlash.value = 0;
    let cancelled = false;

    (async () => {
      // Step 1: Fetch location
      setStatusMsg('Acquiring GPS location...');
      let mapsUrl = '';
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise<null>((r) => setTimeout(() => r(null), 4000)),
          ]);
          if (loc && typeof loc === 'object' && 'coords' in loc) {
            const { latitude, longitude } = (loc as Location.LocationObject).coords;
            mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
          }
        }
      } catch {}
      if (cancelled) return;
      if (!mapsUrl) mapsUrl = 'Location unavailable';

      // Step 2: Fetch contacts
      setStatusMsg('Loading emergency contacts...');
      let contacts: EmergencyContact[] = [];
      try { contacts = await getContacts(); } catch {}
      if (cancelled) return;

      // Step 3: Compose & send SMS
      const phoneNumbers = contacts.map((c) => c.phone).filter(Boolean);
      const message = `\uD83D\uDEA8 EMERGENCY SOS! I need help. My current location is: ${mapsUrl}`;

      if (phoneNumbers.length > 0) {
        setStatusMsg(`Sending SOS to ${phoneNumbers.length} contact(s)...`);
        try {
          const available = await SMS.isAvailableAsync();
          if (available) {
            await SMS.sendSMSAsync(phoneNumbers, message);
          }
        } catch {}
      } else {
        setStatusMsg('No contacts saved — simulating dispatch...');
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (cancelled) return;

      // Step 4: Done!
      triggerHaptic('success');
      setPhase('sent');
    })();

    return () => { cancelled = true; };
  }, [phase]);

  // ── Sent phase — show toast, auto-dismiss ──
  useEffect(() => {
    if (phase !== 'sent') return;
    cancelAnimation(bgPulse);
    bgPulse.value = withTiming(0, { duration: 400 });
    toastOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    toastSlideY.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) });
    const t = setTimeout(() => { if (router.canGoBack()) router.back(); }, 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleCancel = useCallback(() => {
    setPhase('cancelled');
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (hapticRef.current) clearInterval(hapticRef.current);
    cancelAnimation(bgPulse);
    cancelAnimation(bgFlash);
    triggerHaptic('success');
    setTimeout(() => { if (router.canGoBack()) router.back(); }, 500);
  }, []);

  const toastStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value, transform: [{ translateY: toastSlideY.value }] }));
  const displayTime = `00:${countdown.toString().padStart(2, '0')}`;

  // ─── Render ────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Background */}
      <View style={styles.background}>
        <Animated.View style={[styles.bgOverlay, bgStyle]} />
        <Animated.View style={[styles.bgFlashOverlay, bgFlashStyle]} />
        <View style={styles.pulseContainer}>
          <PulseRing delay={0} size={340} />
          <PulseRing delay={550} size={340} />
          <PulseRing delay={1100} size={340} />
          <PulseRing delay={1650} size={340} />
        </View>
        <View style={styles.vignette} />
      </View>

      {/* Content */}
      <Animated.View style={[styles.content, contentFade]}>
        {/* Top badge */}
        <View style={styles.topSection}>
          <View style={styles.warningBadge}><View style={styles.warningBadgeInner}>
            <Ionicons name={phase === 'transmitting' ? 'radio-outline' : phase === 'sent' ? 'checkmark-circle' : 'warning'} size={32} color={phase === 'sent' ? '#4ADE80' : phase === 'transmitting' ? '#FFB020' : RED_BRIGHT} />
          </View></View>
          <Text style={[styles.emergencyLabel, phase === 'transmitting' && { color: '#FFB020' }, phase === 'sent' && { color: '#4ADE80' }]}>
            {phase === 'transmitting' ? 'TRANSMITTING SOS' : phase === 'sent' ? 'SOS SENT' : phase === 'cancelled' ? 'CANCELLED' : 'EMERGENCY DETECTED'}
          </Text>
          <Text style={styles.emergencySub}>
            {phase === 'sent' ? 'SOS has been dispatched' : phase === 'cancelled' ? 'Alert cancelled' : phase === 'transmitting' ? 'Contacting your Safety Circle...' : 'Critical threat identified'}
          </Text>
        </View>

        {/* Center */}
        <View style={styles.centerSection}>
          {phase === 'countdown' && (
            <>
              <CountdownGlowRing />
              <Text style={styles.countdownTimer}>{displayTime}</Text>
              <Text style={styles.autoDispatchText}>AUTO-DISPATCHING SOS...</Text>
              <Text style={styles.subText}>Alerting your Safety Circle & Emergency Services</Text>
              <View style={styles.progressDots}>
                {Array.from({ length: SOS_COUNTDOWN }).map((_, i) => (
                  <View key={i} style={[styles.progressDot, {
                    backgroundColor: i < SOS_COUNTDOWN - countdown ? RED_BRIGHT : 'rgba(255,255,255,0.15)',
                  }, i === SOS_COUNTDOWN - countdown - 1 && { shadowColor: RED_BRIGHT, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 }]} />
                ))}
              </View>
            </>
          )}

          {phase === 'transmitting' && (
            <>
              <TransmittingSpinner />
              <Text style={[styles.autoDispatchText, { color: '#FFB020', marginTop: 24 }]}>TRANSMITTING SOS...</Text>
              <Text style={styles.subText}>{statusMsg || 'Preparing emergency dispatch...'}</Text>
              <ActivityIndicator size="small" color="#FFB020" style={{ marginTop: 16 }} />
            </>
          )}

          {phase === 'sent' && (
            <>
              <Text style={[styles.countdownTimer, styles.countdownDispatched]}>00:00</Text>
              <Text style={[styles.autoDispatchText, { color: '#4ADE80' }]}>SOS SENT SUCCESSFULLY</Text>
              <Text style={styles.subText}>{'Your safety circle has been notified.\nHelp is on the way.'}</Text>
            </>
          )}

          {phase === 'cancelled' && (
            <>
              <Text style={[styles.countdownTimer, styles.countdownCancelled]}>{displayTime}</Text>
              <Text style={[styles.autoDispatchText, { color: '#4DA6FF' }]}>CANCELLED</Text>
              <Text style={styles.subText}>Alert has been cancelled successfully.</Text>
            </>
          )}
        </View>

        {/* Bottom */}
        <View style={styles.bottomSection}>
          {phase === 'countdown' && (
            <View style={styles.sliderContainer}>
              <SlideToCancel onCancel={handleCancel} />
              <Text style={styles.sliderHint}>Drag the button to abort the SOS</Text>
            </View>
          )}
          {phase === 'sent' && (
            <Animated.View style={[styles.toastContainer, styles.toastSuccess, toastStyle]}>
              <View style={styles.toastIconBg}><Ionicons name="checkmark-circle" size={28} color="#4ADE80" /></View>
              <View style={styles.toastTextGroup}>
                <Text style={styles.toastTitle}>SOS Dispatched to Safety Circle</Text>
                <Text style={styles.toastSub}>Location shared • SMS sent</Text>
              </View>
            </Animated.View>
          )}
          {phase === 'cancelled' && (
            <View style={[styles.toastContainer, styles.toastCancelled]}>
              <View style={styles.toastIconBg}><Ionicons name="checkmark-circle" size={28} color="#4DA6FF" /></View>
              <View style={styles.toastTextGroup}>
                <Text style={styles.toastTitle}>Alert Cancelled</Text>
                <Text style={styles.toastSub}>Returning to radar...</Text>
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
  root: { flex: 1 },
  background: { ...StyleSheet.absoluteFillObject, backgroundColor: RED_ABYSS },
  bgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: RED_CORE },
  bgFlashOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: RED_HOT },
  pulseContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  pulseRing: { position: 'absolute', borderWidth: 2, borderColor: RED_BRIGHT },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', borderWidth: SW * 0.3, borderColor: 'rgba(0,0,0,0.25)', borderRadius: SW },
  content: { flex: 1, justifyContent: 'space-between', paddingTop: 70, paddingBottom: 50, paddingHorizontal: 24 },
  topSection: { alignItems: 'center' },
  warningBadge: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,45,85,0.12)', justifyContent: 'center', alignItems: 'center' },
  warningBadgeInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,45,85,0.2)', borderWidth: 2, borderColor: RED_BRIGHT, justifyContent: 'center', alignItems: 'center' },
  emergencyLabel: { fontSize: 15, fontWeight: '800', color: RED_GLOW, letterSpacing: 4, marginTop: 18, textTransform: 'uppercase' },
  emergencySub: { fontSize: 15, color: 'rgba(255,255,255,0.4)', marginTop: 6 },
  centerSection: { alignItems: 'center', justifyContent: 'center' },
  countdownTimer: { fontSize: 104, fontWeight: '200', color: '#FFF', letterSpacing: 6, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(255,45,85,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 30 },
  countdownDispatched: { color: '#4ADE80', textShadowColor: 'rgba(74,222,128,0.4)' },
  countdownCancelled: { color: '#4DA6FF', textShadowColor: 'rgba(77,166,255,0.4)' },
  autoDispatchText: { fontSize: 17, fontWeight: '800', color: RED_GLOW, letterSpacing: 2.5, marginTop: 10, textTransform: 'uppercase' },
  subText: { fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 14, textAlign: 'center', lineHeight: 22 },
  progressDots: { flexDirection: 'row', gap: 6, marginTop: 28 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  bottomSection: { alignItems: 'center' },
  sliderContainer: { width: SLIDER_TRACK_WIDTH, alignItems: 'center' },
  sliderTrack: { width: '100%', height: SLIDER_THUMB + SLIDER_PAD * 2, borderRadius: (SLIDER_THUMB + SLIDER_PAD * 2) / 2, backgroundColor: 'rgba(255,45,85,0.18)', borderWidth: 1.5, borderColor: 'rgba(255,45,85,0.35)', justifyContent: 'center', overflow: 'hidden' },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: (SLIDER_THUMB + SLIDER_PAD * 2) / 2 },
  sliderTextContainer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingLeft: SLIDER_THUMB },
  sliderLabel: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginHorizontal: 6 },
  sliderThumb: { position: 'absolute', left: SLIDER_PAD, width: SLIDER_THUMB, height: SLIDER_THUMB, borderRadius: SLIDER_THUMB / 2, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: RED_BRIGHT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 10 },
  sliderHint: { fontSize: 13, color: 'rgba(255,255,255,0.25)', marginTop: 14 },
  toastContainer: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18, borderRadius: 18, borderWidth: 1 },
  toastSuccess: { backgroundColor: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.25)' },
  toastCancelled: { backgroundColor: 'rgba(77,166,255,0.08)', borderColor: 'rgba(77,166,255,0.25)' },
  toastIconBg: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  toastTextGroup: { flex: 1 },
  toastTitle: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  toastSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  // Transmitting spinner
  spinnerContainer: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
  spinnerRingOuter: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: 'transparent', borderTopColor: '#FFB020', borderRightColor: '#FFB02066' },
  spinnerInner: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,176,32,0.12)', borderWidth: 2, borderColor: 'rgba(255,176,32,0.3)', justifyContent: 'center', alignItems: 'center' },
});
