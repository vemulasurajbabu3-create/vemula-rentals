import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, clearAuth } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setStats(await api("/admin/stats")); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logout = async () => { await clearAuth(); router.replace("/auth/login"); };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-dashboard">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>Admin</Text>
            <Text style={styles.title}>Business Dashboard</Text>
          </View>
          <Pressable onPress={logout} testID="admin-logout"><Ionicons name="log-out-outline" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <View style={styles.grid}>
          <Metric label="Total Vehicles" value={stats?.total_vehicles ?? 0} icon="bicycle" />
          <Metric label="Active Rentals" value={stats?.rented_vehicles ?? 0} icon="key" />
          <Metric label="Total Users" value={stats?.total_users ?? 0} icon="people" />
          <Metric label="Pending Docs" value={stats?.pending_documents ?? 0} icon="document-text" />
        </View>

        <View style={[styles.earnCard, shadow.card]}>
          <View>
            <Text style={styles.earnLabel}>Total Earned</Text>
            <Text style={styles.earnAmount}>₹{Number(stats?.total_earned || 0).toFixed(0)}</Text>
          </View>
          <View style={styles.divider} />
          <View>
            <Text style={styles.earnLabel}>Pending</Text>
            <Text style={[styles.earnAmount, { color: colors.warning }]}>₹{Number(stats?.pending_amount || 0).toFixed(0)}</Text>
            <Text style={styles.earnSub}>{stats?.pending_payments ?? 0} payment(s) due</Text>
          </View>
        </View>

        <Text style={styles.section}>Quick Actions</Text>
        <ActionRow icon="bicycle-outline" label="Manage Vehicles" onPress={() => router.push("/admin/vehicles")} />
        <ActionRow icon="people-outline" label="Manage Users & Assign Vehicles" onPress={() => router.push("/admin/users")} />
        <ActionRow icon="cash-outline" label="Track Payments" onPress={() => router.push("/admin/payments")} />
        <ActionRow icon="document-text-outline" label="Review Documents" onPress={() => router.push("/admin/more")} />
        <ActionRow icon="megaphone-outline" label="Send Announcement" onPress={() => router.push("/admin/more")} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: any }) {
  return (
    <View style={[styles.metric, shadow.card]}>
      <View style={styles.metricIcon}><Ionicons name={icon} size={18} color={colors.brandPrimary} /></View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, shadow.card, pressed && { backgroundColor: colors.surfaceSecondary }]} testID={`action-${label}`}>
      <View style={styles.metricIcon}><Ionicons name={icon} size={18} color={colors.brandPrimary} /></View>
      <Text style={styles.actionText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.lg },
  kicker: { color: colors.brandPrimary, fontSize: type.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },
  metric: { width: "50%", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, marginHorizontal: 0, marginBottom: spacing.md },
  metricIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  metricValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface },
  metricLabel: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  earnCard: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, marginTop: spacing.md },
  earnLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: type.sm },
  earnAmount: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: "800", marginTop: 2 },
  earnSub: { color: colors.onBrandPrimary, opacity: 0.7, fontSize: type.sm, marginTop: 2 },
  divider: { width: 1, height: 48, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: spacing.lg },
  section: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  actionRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, marginBottom: spacing.sm, gap: spacing.md },
  actionText: { flex: 1, color: colors.onSurface, fontSize: type.base, fontWeight: "600" },
});

// Fix grid width: each child gets paddingHorizontal handled by row
