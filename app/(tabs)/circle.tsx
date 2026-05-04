import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/Colors';

type Contact = { id: string; name: string; initials: string; relation: string; color: string };

const CONTACTS: Contact[] = [
  { id: '1', name: 'Sarah Johnson', initials: 'SJ', relation: 'Emergency Contact', color: '#FF6B8A' },
  { id: '2', name: 'Dr. Patel', initials: 'DP', relation: 'Primary Doctor', color: '#6B8AFF' },
  { id: '3', name: 'Mike Chen', initials: 'MC', relation: 'Neighbor', color: '#FFB020' },
  { id: '4', name: 'Local Fire Dept.', initials: 'FD', relation: 'Emergency Service', color: '#FF4C6E' },
];

export default function CircleScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Safety Circle</Text>
        <Text style={styles.subtitle}>People who receive your SOS alerts</Text>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {CONTACTS.map((c) => (
          <TouchableOpacity key={c.id} style={styles.card} activeOpacity={0.7}>
            <View style={[styles.avatar, { backgroundColor: c.color + '22' }]}>
              <Text style={[styles.avatarText, { color: c.color }]}>{c.initials}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.relation}>{c.relation}</Text>
            </View>
            <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.addButton} activeOpacity={0.7}>
          <Ionicons name="add-circle-outline" size={28} color={theme.colors.accent} />
          <Text style={styles.addText}>Add Contact</Text>
        </TouchableOpacity>
      </ScrollView>
      <View style={styles.tip}>
        <Ionicons name="information-circle-outline" size={18} color={theme.colors.textTertiary} />
        <Text style={styles.tipText}>Your circle is notified instantly when you trigger an SOS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: theme.colors.textSecondary, marginTop: 4 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  info: { flex: 1, marginLeft: 16 },
  name: { fontSize: 17, fontWeight: '600', color: theme.colors.text },
  relation: { fontSize: 14, color: theme.colors.textTertiary, marginTop: 2 },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 20, borderWidth: 1.5, borderColor: theme.colors.border, borderStyle: 'dashed', borderRadius: 12, marginTop: 8 },
  addText: { fontSize: 16, fontWeight: '600', color: theme.colors.accent },
  tip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 24, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  tipText: { fontSize: 13, color: theme.colors.textTertiary, flex: 1 },
});
