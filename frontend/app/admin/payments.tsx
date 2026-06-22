import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function AdminPayments() {
  const [payments, setPayments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([api<any[]>("/admin/payments"), api<any[]>("/admin/users")]);
      setPayments(p);
      setUsers(u);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const userMap: Record<string, any> = {};
  users.forEach((u) => { userMap[u.id] = u; });

  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const totalPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-payments">
      <View style={styles.header}><Text style={styles.h1}>Payments</Text></View>
      <View style={[styles.summary, shadow.card]}>
        <View style={styles.summaryHalf}>
          <Text style={styles.summaryLabel}>Earned</Text>
          <Text style={styles.summaryAmt}>₹{totalPaid.toFixed(0)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryHalf}>
          <Text style={styles.summaryLabel}>Pending</Text>
          <Text style={[styles.summaryAmt, { color: colors.warning }]}>₹{totalPending.toFixed(0)}</Text>
        </View>
      </View>
      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<Text style={styles.muted}>No payments yet.</Text>}
        renderItem={({ item }) => {
          const u = userMap[item.user_id];
          return (
            <View style={[styles.row, shadow.card]} testID={`payment-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.amt}>₹{Number(item.amount).toFixed(0)}</Text>
                <Text style={styles.meta}>{u?.full_name || u?.phone || "Unknown"} · {new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</Text>
                {item.transaction_id ? <Text style={styles.txn}>Txn: {item.transaction_id}</Text> : null}
              </View>
              <View style={[styles.chip, { backgroundColor: item.status === "paid" ? colors.brandSecondary : colors.warning + "22" }]}>
                <Text style={[styles.chipText, { color: item.status === "paid" ? colors.onBrandSecondary : colors.warning }]}>{item.status}</Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  summary: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, flexDirection: "row", alignItems: "center" },
  summaryHalf: { flex: 1 },
  summaryLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: type.sm },
  summaryAmt: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: "800", marginTop: 2 },
  summaryDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.2)" },
  row: { flexDirection: "row", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, alignItems: "center" },
  amt: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  meta: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  txn: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  chipText: { fontWeight: "700", fontSize: type.sm, textTransform: "capitalize" },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
});
