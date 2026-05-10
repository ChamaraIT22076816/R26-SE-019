import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '@/constants/Colors';
import { getSettings, saveSetting } from '@/utils/storage';
import type { AppSettings } from '@/utils/storage';

// ─── Custom Slider (pure RN, no extra deps) ─────────────────────
function SensitivitySlider({ value, onValueChange }: { value: number; onValueChange: (v: number) => void }) {
  const steps = [1, 2, 3, 4, 5];
  const labels = ['Low', '', 'Med', '', 'High'];
  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${((value - 1) / 4) * 100}%` }]} />
      </View>
      <View style={styles.sliderSteps}>
        {steps.map((step) => (
          <TouchableOpacity key={step} style={styles.sliderStepHitbox} activeOpacity={0.7} onPress={() => onValueChange(step)}>
            <View style={[styles.sliderDot, step <= value && styles.sliderDotActive, step === value && styles.sliderDotCurrent]} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.sliderLabels}>
        {labels.map((label, idx) => (
          <Text key={idx} style={[styles.sliderLabelText, steps[idx] === value && styles.sliderLabelActive]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Setting Row Component ──────────────────────────────────────
function SettingToggle({ icon, iconColor, label, description, value, onValueChange }: {
  icon: keyof typeof Ionicons.glyphMap; iconColor: string;
  label: string; description: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={[styles.settingIcon, { backgroundColor: iconColor + '15' }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.accentMuted }}
        thumbColor={value ? theme.colors.accent : theme.colors.textTertiary}
      />
    </View>
  );
}

// ─── Main Settings Screen ───────────────────────────────────────
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<AppSettings>({
    hapticFeedback: true, flashlight: false, backgroundListening: true,
    sensitivity: 3, autoCall: false, shareLocation: true, nightMode: false,
  });

  // Load persisted settings on focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const stored = await getSettings();
        setS(stored);
      })();
    }, [])
  );

  // Helper — update local state AND persist to AsyncStorage
  const toggle = <K extends keyof AppSettings>(key: K) => async (value: AppSettings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    await saveSetting(key, value);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Configure SoundGuard preferences</Text>
        </View>

        {/* ── Detection Section ── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionLabel}>DETECTION</Text></View>
        <View style={styles.sectionCard}>
          <SettingToggle icon="pulse-outline" iconColor={theme.colors.accent} label="Enable Haptic Feedback" description="Vibrate phone on sound detection" value={s.hapticFeedback} onValueChange={toggle('hapticFeedback')} />
          <View style={styles.settingDivider} />
          <SettingToggle icon="flashlight-outline" iconColor="#FFB020" label="Critical Alert Flashlight" description="Flash camera LED on critical threats" value={s.flashlight} onValueChange={toggle('flashlight')} />
          <View style={styles.settingDivider} />
          <SettingToggle icon="ear-outline" iconColor="#6B8AFF" label="Background Listening Mode" description="Continue monitoring when app is minimized" value={s.backgroundListening} onValueChange={toggle('backgroundListening')} />
        </View>

        {/* ── AI Sensitivity ── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionLabel}>AI SENSITIVITY</Text></View>
        <View style={styles.sensitivityCard}>
          <View style={styles.sensitivityHeader}>
            <View style={[styles.settingIcon, { backgroundColor: '#A78BFA15' }]}>
              <Ionicons name="analytics-outline" size={20} color="#A78BFA" />
            </View>
            <View style={styles.sensitivityHeaderText}>
              <Text style={styles.settingLabel}>AI Sensitivity Level</Text>
              <Text style={styles.settingDesc}>
                {s.sensitivity <= 2 ? 'Fewer false positives, may miss quiet sounds' : s.sensitivity >= 4 ? 'Catches more sounds, may trigger more alerts' : 'Balanced detection for most environments'}
              </Text>
            </View>
          </View>
          <SensitivitySlider value={s.sensitivity} onValueChange={toggle('sensitivity')} />
          <View style={styles.sensitivityBadge}>
            <Ionicons name="speedometer-outline" size={14} color={s.sensitivity >= 4 ? '#FF6B8A' : s.sensitivity <= 2 ? '#4DA6FF' : '#FFB020'} />
            <Text style={[styles.sensitivityBadgeText, { color: s.sensitivity >= 4 ? '#FF6B8A' : s.sensitivity <= 2 ? '#4DA6FF' : '#FFB020' }]}>
              Level {s.sensitivity} — {s.sensitivity <= 2 ? 'Conservative' : s.sensitivity >= 4 ? 'Aggressive' : 'Balanced'}
            </Text>
          </View>
        </View>

        {/* ── Emergency Section ── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionLabel}>EMERGENCY</Text></View>
        <View style={styles.sectionCard}>
          <SettingToggle icon="call-outline" iconColor="#FF3B5C" label="SOS Auto-Call" description="Auto-dial emergency services on SOS dispatch" value={s.autoCall} onValueChange={toggle('autoCall')} />
          <View style={styles.settingDivider} />
          <SettingToggle icon="location-outline" iconColor={theme.colors.accent} label="Share Location in SOS" description="Include GPS coordinates in SOS alerts" value={s.shareLocation} onValueChange={toggle('shareLocation')} />
          <View style={styles.settingDivider} />
          <SettingToggle icon="moon-outline" iconColor="#C084FC" label="Night Mode Sensitivity" description="Increase sensitivity during nighttime hours" value={s.nightMode} onValueChange={toggle('nightMode')} />
        </View>

        {/* ── App Section ── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionLabel}>APP</Text></View>
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(100,100,122,0.12)' }]}>
              <Ionicons name="language-outline" size={20} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Language</Text><Text style={styles.settingDesc}>English</Text></View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.settingDivider} />
          <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(100,100,122,0.12)' }]}>
              <Ionicons name="help-circle-outline" size={20} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Help & Support</Text></View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.settingDivider} />
          <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(100,100,122,0.12)' }]}>
              <Ionicons name="document-text-outline" size={20} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Privacy Policy</Text></View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>SoundGuard v1.0.0</Text>
        <Text style={styles.versionSub}>Build 2026.05.09 • Expo SDK 54</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { paddingHorizontal: 24 },
  header: { paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4 },
  sectionHeader: { marginTop: 24, marginBottom: 10, paddingLeft: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textTertiary, letterSpacing: 1 },
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  settingIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1, marginLeft: 14 },
  settingLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  settingDesc: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 2, lineHeight: 18 },
  settingDivider: { height: 1, backgroundColor: theme.colors.border, marginLeft: 68 },
  linkRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  sensitivityCard: { backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16 },
  sensitivityHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  sensitivityHeaderText: { flex: 1, marginLeft: 14 },
  sensitivityBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, marginTop: 16, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
  sensitivityBadgeText: { fontSize: 13, fontWeight: '600' },
  sliderContainer: { paddingHorizontal: 4 },
  sliderTrack: { height: 4, backgroundColor: theme.colors.border, borderRadius: 2, overflow: 'hidden' },
  sliderFill: { height: '100%', backgroundColor: theme.colors.accent, borderRadius: 2 },
  sliderSteps: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -10 },
  sliderStepHitbox: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sliderDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.border, borderWidth: 3, borderColor: theme.colors.surface },
  sliderDotActive: { backgroundColor: theme.colors.accent },
  sliderDotCurrent: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent + '44', width: 20, height: 20, borderRadius: 10, borderWidth: 4 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  sliderLabelText: { fontSize: 11, fontWeight: '600', color: theme.colors.textTertiary, width: 36, textAlign: 'center' },
  sliderLabelActive: { color: theme.colors.accent },
  version: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: theme.colors.textTertiary, marginTop: 32 },
  versionSub: { textAlign: 'center', fontSize: 12, color: theme.colors.textTertiary, marginTop: 4, opacity: 0.6 },
});
