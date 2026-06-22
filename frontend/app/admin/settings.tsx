import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type S = { reminder_weekday: number; reminder_hour_ist: number; late_fee_per_day: number; grace_days: number };

export default function AdminSettings() {
  const router = useRouter();
  const [s, setS] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);

  const load = useCallback(async () => {
    try { setS(await api<S>("/admin/settings")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = (patch: Partial<S>) => setS((prev) => prev ? { ...prev, ...patch } : prev);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const next = await api<S>("/admin/settings", { method: "PUT", body: s });
      setS(next);
      setSavedAt(Date.now());
    } catch {} finally { setSaving(false); }
  };

  if (loading || !s) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const justSaved = savedAt > 0 && Date.now() - savedAt < 3000;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="settings-back" style={styles.back}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.h1}>Business Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {/* Reminder schedule */}
        <Text style={styles.section}>Weekly Reminder Schedule</Text>
        <View style={[styles.card, shadow.card]}>
          <Text style={styles.label}>Day of week</Text>
          <View style={styles.chipsRow}>
            {WEEKDAYS.map((w, i) => (
              <Pressable
                key={w}
                testID={`weekday-${i}`}
                onPress={() => update({ reminder_weekday: i })}
                style={[styles.chip, s.reminder_weekday === i && styles.chipActive]}
              >
                <Text style={[styles.chipText, s.reminder_weekday === i && styles.chipTextActive]}>{w.slice(0, 3)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Hour of day (IST, 0-23)</Text>
          <View style={styles.stepperRow}>
            <Pressable testID="hour-dec" onPress={() => update({ reminder_hour_ist: Math.max(0, s.reminder_hour_ist - 1) })} style={styles.stepBtn}><Ionicons name="remove" size={18} color={colors.onSurface} /></Pressable>
            <Text style={styles.stepperValue} testID="hour-value">{s.reminder_hour_ist.toString().padStart(2, "0")}:00 IST</Text>
            <Pressable testID="hour-inc" onPress={() => update({ reminder_hour_ist: Math.min(23, s.reminder_hour_ist + 1) })} style={styles.stepBtn}><Ionicons name="add" size={18} color={colors.onSurface} /></Pressable>
          </View>
          <Text style={styles.hint}>Reminders will fire every {WEEKDAYS[s.reminder_weekday]} at {s.reminder_hour_ist.toString().padStart(2, "0")}:00 IST to all customers with pending dues.</Text>
        </View>

        {/* Late fee */}
        <Text style={styles.section}>Late Fee Policy</Text>
        <View style={[styles.card, shadow.card]}>
          <Text style={styles.label}>Late fee per day (₹)</Text>
          <TextInput
            testID="late-fee-input"
            keyboardType="numeric"
            value={String(s.late_fee_per_day)}
            onChangeText={(t) => update({ late_fee_per_day: Number(t.replace(/[^0-9.]/g, "")) || 0 })}
            style={styles.input}
            placeholderTextColor={colors.onSurfaceSecondary}
          />
          <Text style={styles.label}>Grace period (days, no fee)</Text>
          <TextInput
            testID="grace-input"
            keyboardType="numeric"
            value={String(s.grace_days)}
            onChangeText={(t) => update({ grace_days: Math.max(0, parseInt(t.replace(/[^0-9]/g, "") || "0", 10)) })}
            style={styles.input}
            placeholderTextColor={colors.onSurfaceSecondary}
          />
          <Text style={styles.hint}>If a customer is late by more than {s.grace_days} day(s), ₹{s.late_fee_per_day} per extra day is auto-added to their pending payment.</Text>
        </View>

        <Pressable testID="save-settings-button" onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <Ionicons name={justSaved ? "checkmark-circle" : "save"} size={18} color={colors.onBrandPrimary} />
              <Text style={styles.saveText}>{justSaved ? "Saved" : "Save Settings"}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { padding: spacing.sm },
  h1: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  section: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.md },
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: type.sm, fontWeight: "700", color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepperValue: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface, minWidth: 120, textAlign: "center" },
  hint: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: spacing.md, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 48, fontSize: type.lg, color: colors.onSurface, marginBottom: spacing.lg },
  saveBtn: { marginTop: spacing.xl, flexDirection: "row", gap: 6, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
});
