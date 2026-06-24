import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import { api, clearAuth } from "@/src/api/client";
import BusinessContact from "@/src/components/BusinessContact";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function Profile() {
  const router = useRouter();
  const [profile, setProfile] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const p = await api<any>("/users/me");
      setProfile(p);
      setName(p.full_name || "");
      setAddress(p.address || "");
      setEmName(p.emergency_contact_name || "");
      setEmPhone(p.emergency_contact_phone || "");
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    setSaving(true);
    try {
      await api("/users/me", { method: "PUT", body: {
        full_name: name, address,
        emergency_contact_name: emName, emergency_contact_phone: emPhone,
      } });
      await load();
    } catch {} finally { setSaving(false); }
  };

  const pickContact = async () => {
    if (Platform.OS === "web") { alert("Contact picker is available in the mobile app."); return; }
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== "granted") return;
      const c = await Contacts.presentContactPickerAsync();
      if (!c) return;
      const phones = (c.phoneNumbers || []).map((p: any) => p?.number || "").filter(Boolean);
      setEmName(c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim());
      setEmPhone((phones[0] || "").replace(/\D/g, "").slice(-10) || phones[0] || "");
    } catch (e: any) { console.warn(e?.message); }
  };

  const logout = async () => {
    await clearAuth();
    router.replace("/auth/login");
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="profile-screen">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}><Ionicons name="person" size={32} color={colors.onBrandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile?.full_name || "Add your name"}</Text>
            <Text style={styles.phone}>+91 {profile?.phone}</Text>
          </View>
        </View>

        <Text style={styles.section}>Account Details</Text>
        <View style={[styles.formCard, shadow.card]}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput testID="name-input" value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.onSurfaceSecondary} style={styles.input} />
          <View style={styles.divider} />
          <Text style={styles.label}>Address</Text>
          <TextInput
            testID="address-input"
            value={address}
            onChangeText={setAddress}
            placeholder="Your registered address"
            placeholderTextColor={colors.onSurfaceSecondary}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
            multiline
          />
          <Pressable testID="save-profile-button" onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Changes</Text>}
          </Pressable>
        </View>

        <Text style={styles.section}>Emergency Contact</Text>
        <View style={[styles.formCard, shadow.card]}>
          <Text style={styles.label}>Contact Name</Text>
          <TextInput testID="em-name-input" value={emName} onChangeText={setEmName} placeholder="e.g. Anjali" placeholderTextColor={colors.onSurfaceSecondary} style={styles.input} />
          <View style={styles.divider} />
          <Text style={styles.label}>Contact Phone</Text>
          <TextInput testID="em-phone-input" value={emPhone} onChangeText={(t) => setEmPhone(t.replace(/\D/g, "").slice(0, 15))} placeholder="98765 43210" placeholderTextColor={colors.onSurfaceSecondary} keyboardType="phone-pad" style={styles.input} />
          <Pressable testID="pick-contact-button" onPress={pickContact} style={({ pressed }) => [styles.pickContactBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="people" size={18} color={colors.brandPrimary} />
            <Text style={styles.pickContactText}>Pick from Contacts</Text>
          </Pressable>
        </View>

        <Pressable testID="history-link" onPress={() => router.push("/customer/history")} style={({ pressed }) => [styles.historyRow, pressed && { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="time" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>Rental History</Text>
            <Text style={styles.historySub}>View past and current bookings, deposits, and refunds</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
        </Pressable>

        <Pressable testID="logout-button" onPress={logout} style={({ pressed }) => [styles.logoutRow, pressed && { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>

        <View style={{ marginTop: spacing.xl }}>
          <BusinessContact />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginBottom: spacing.xl },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  phone: { color: colors.onSurfaceSecondary, marginTop: 2 },
  section: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  input: { fontSize: type.lg, color: colors.onSurface, paddingVertical: spacing.sm },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
  logoutRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, marginTop: spacing.xl, borderRadius: radius.md },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: type.base },
  pickContactBtn: { marginTop: spacing.md, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  pickContactText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.base },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, marginTop: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
  historyTitle: { color: colors.onSurface, fontSize: type.base, fontWeight: "700" },
  historySub: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
});
