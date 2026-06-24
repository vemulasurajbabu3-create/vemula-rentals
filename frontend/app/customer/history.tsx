import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type Booking = any;

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: colors.brandPrimary, bg: colors.brandTertiary },
  return_requested: { label: "Return Requested", color: colors.warning, bg: colors.warning + "22" },
  returned: { label: "Returned", color: colors.onBrandSecondary, bg: colors.brandSecondary },
  cancelled: { label: "Cancelled", color: colors.onSurfaceSecondary, bg: colors.surfaceSecondary },
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
}

export default function HistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api("/bookings/me")); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="history-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Rental History</Text>
        <Text style={styles.sub}>{items.length} {items.length === 1 ? "booking" : "bookings"}</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
        ListEmptyComponent={
          <View style={styles.empty} testID="history-empty">
            <Ionicons name="time-outline" size={48} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No rentals yet</Text>
            <Text style={styles.emptyBody}>Your rental history will appear here once a vehicle is assigned to you.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status] || STATUS_META.active;
          const snap = item.vehicle_snapshot || {};
          return (
            <View style={[styles.card, shadow.card]} testID={`booking-${item.id}`}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.model} numberOfLines={1}>{snap.model || "Vehicle"}</Text>
                  <Text style={styles.plate}>{snap.number_plate || "—"}</Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>

              <View style={styles.rowGrid}>
                <Spec icon="calendar-outline" label="From" value={fmtDate(item.start_date)} />
                <Spec icon="calendar-outline" label="To" value={fmtDate(item.end_date)} />
                <Spec icon="cash-outline" label="Weekly Rent" value={`\u20b9${Number(snap.weekly_rent || 0).toFixed(0)}`} />
                {item.status === "returned" ? (
                  <Spec icon="receipt-outline" label="Rent Paid" value={`\u20b9${Number(item.total_rent_paid || 0).toFixed(0)}`} />
                ) : (
                  <Spec icon="speedometer-outline" label="Status" value={meta.label} />
                )}
              </View>

              <View style={styles.depositRow}>
                <View style={styles.depositCell}>
                  <Text style={styles.depLabel}>Deposit paid</Text>
                  <Text style={styles.depValue}>₹{Number(item.deposit_paid ?? snap.security_deposit ?? 0).toFixed(0)}</Text>
                </View>
                <View style={styles.depositCellMid}>
                  <Text style={styles.depLabel}>Refunded</Text>
                  <Text style={[styles.depValue, item.status === "returned" && { color: colors.brandPrimary }]}>
                    {item.status === "returned" ? `\u20b9${Number(item.deposit_refunded || 0).toFixed(0)}` : "—"}
                  </Text>
                </View>
                <View style={styles.depositCell}>
                  <Text style={styles.depLabel}>Damages</Text>
                  <Text style={[styles.depValue, item.status === "returned" && Number(item.damages_amount ?? (Number(item.deposit_paid || 0) - Number(item.deposit_refunded || 0))) > 0 && { color: colors.error }]}>
                    {item.status === "returned"
                      ? `₹${Number(item.damages_amount ?? Math.max(0, Number(item.deposit_paid || 0) - Number(item.deposit_refunded || 0))).toFixed(0)}`
                      : "—"}
                  </Text>
                </View>
              </View>
              {item.status === "returned" && Number(item.wallet_retained || 0) > 0 ? (
                <View style={styles.walletKeptBox} testID={`wallet-kept-${item.id}`}>
                  <Ionicons name="wallet" size={16} color={colors.brandPrimary} />
                  <Text style={styles.walletKeptText}>₹{Number(item.wallet_retained || 0).toFixed(0)} retained in your wallet for your next rental.</Text>
                </View>
              ) : null}

              {item.customer_notes ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteLabel}>Your note</Text>
                  <Text style={styles.noteText}>{item.customer_notes}</Text>
                </View>
              ) : null}
              {item.admin_notes ? (
                <View style={[styles.noteBox, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.noteLabel}>Admin note</Text>
                  <Text style={styles.noteText}>{item.admin_notes}</Text>
                </View>
              ) : null}

              {(item.status === "active" || item.status === "return_requested") && (
                <Pressable
                  testID={`open-current-${item.id}`}
                  onPress={() => router.push("/customer/vehicle")}
                  style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="open-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.openBtnText}>{item.status === "return_requested" ? "Return Requested · View" : "View Active Rental"}</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Spec({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.specBox}>
      <Ionicons name={icon} size={16} color={colors.brandPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.specLabel}>{label}</Text>
        <Text style={styles.specValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  sub: { color: colors.onSurfaceSecondary, marginTop: 2 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  emptyBody: { color: colors.onSurfaceSecondary, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider, gap: spacing.md },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  model: { fontSize: type.lg, fontWeight: "800", color: colors.onSurface },
  plate: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusChipText: { fontSize: type.sm, fontWeight: "700" },
  rowGrid: { flexDirection: "row", flexWrap: "wrap" },
  specBox: { width: "50%", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  specLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary },
  specValue: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  depositRow: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  depositCell: { flex: 1, alignItems: "flex-start" },
  depositCellMid: { flex: 1, alignItems: "center" },
  depLabel: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginBottom: 2 },
  depValue: { color: colors.onSurface, fontSize: type.base, fontWeight: "700" },
  walletKeptBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  walletKeptText: { color: colors.onSurface, fontSize: type.sm, flex: 1, fontWeight: "600" },
  noteBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  noteLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  noteText: { color: colors.onSurface, fontSize: type.base, lineHeight: 20 },
  openBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  openBtnText: { color: colors.brandPrimary, fontWeight: "700" },
});
