import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, TextInput, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type Booking = any;
type UserLite = { id: string; full_name?: string | null; phone: string };

const FILTERS: { key: string; label: string; status?: string }[] = [
  { key: "return_requested", label: "Returns", status: "return_requested" },
  { key: "active", label: "Active", status: "active" },
  { key: "returned", label: "Past", status: "returned" },
  { key: "all", label: "All" },
];

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); } catch { return "—"; }
}

export default function AdminBookings() {
  const [items, setItems] = useState<Booking[]>([]);
  const [users, setUsers] = useState<Record<string, UserLite>>({});
  const [filter, setFilter] = useState<string>("return_requested");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<Booking | null>(null);
  const [refundAmt, setRefundAmt] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const f = FILTERS.find((x) => x.key === filter);
      const qs = f?.status ? `?status=${encodeURIComponent(f.status)}` : "";
      const [bs, us] = await Promise.all([
        api<Booking[]>(`/admin/bookings${qs}`),
        api<UserLite[]>("/admin/users"),
      ]);
      setItems(bs);
      const map: Record<string, UserLite> = {};
      us.forEach((u) => { map[u.id] = u; });
      setUsers(map);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const openConfirm = (b: Booking) => {
    const dep = Number(b.vehicle_snapshot?.security_deposit || 0);
    setRefundAmt(String(dep));
    setAdminNote("");
    setConfirming(b);
  };

  const submitConfirm = async () => {
    if (!confirming) return;
    const amt = Number(refundAmt);
    if (Number.isNaN(amt) || amt < 0) return;
    setSaving(true);
    try {
      await api(`/admin/bookings/${confirming.id}/confirm-return`, {
        method: "POST",
        body: { refund_amount: amt, notes: adminNote || undefined },
      });
      setConfirming(null);
      await load();
    } catch {
      // best-effort: leave modal open if error
    } finally { setSaving(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-bookings">
      <View style={styles.header}><Text style={styles.h1}>Bookings</Text></View>
      <View style={styles.tabs}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            testID={`booking-filter-${f.key}`}
            onPress={() => setFilter(f.key)}
            style={[styles.tab, filter === f.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
        ListEmptyComponent={<Text style={styles.muted}>No bookings to show.</Text>}
        renderItem={({ item }) => {
          const user = users[item.user_id];
          const snap = item.vehicle_snapshot || {};
          return (
            <View style={[styles.card, shadow.card]} testID={`admin-booking-${item.id}`}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rider} numberOfLines={1}>{user?.full_name || user?.phone || "Customer"}</Text>
                  <Text style={styles.phone}>+91 {user?.phone || "—"}</Text>
                </View>
                <View style={[styles.statusChip, statusColor(item.status)]}>
                  <Text style={[styles.statusText, statusTextColor(item.status)]}>{statusLabel(item.status)}</Text>
                </View>
              </View>
              <View style={styles.vehLine}>
                <Ionicons name="bicycle" size={18} color={colors.brandPrimary} />
                <Text style={styles.vehText} numberOfLines={1}>{snap.model || "Vehicle"} · {snap.number_plate}</Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.spec}>From {fmtDate(item.start_date)}</Text>
                <Text style={styles.spec}>To {fmtDate(item.end_date)}</Text>
                <Text style={styles.spec}>₹{Number(snap.weekly_rent || 0).toFixed(0)}/wk</Text>
              </View>
              {item.customer_notes ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteLabel}>Customer note</Text>
                  <Text style={styles.noteText}>{item.customer_notes}</Text>
                </View>
              ) : null}
              {item.status === "returned" ? (
                <View style={styles.depositRow}>
                  <Text style={styles.depTxt}>Paid ₹{Number(item.total_rent_paid || 0).toFixed(0)} rent</Text>
                  <Text style={styles.depTxt}>Refunded ₹{Number(item.deposit_refunded || 0).toFixed(0)} of ₹{Number(item.deposit_paid || 0).toFixed(0)}</Text>
                </View>
              ) : null}
              {item.status === "return_requested" && (
                <Pressable
                  testID={`confirm-return-button-${item.id}`}
                  onPress={() => openConfirm(item)}
                  style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="checkmark-circle" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.ctaText}>Confirm Return</Text>
                </Pressable>
              )}
              {item.status === "active" && (
                <Pressable
                  testID={`force-return-button-${item.id}`}
                  onPress={() => openConfirm(item)}
                  style={({ pressed }) => [styles.ctaGhost, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="swap-horizontal" size={16} color={colors.brandPrimary} />
                  <Text style={styles.ctaGhostText}>Mark Returned</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />

      <Modal visible={!!confirming} transparent animationType="slide" onRequestClose={() => setConfirming(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="confirm-return-sheet">
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Confirm Return</Text>
            <Text style={styles.sheetSub}>{confirming?.vehicle_snapshot?.model} · {confirming?.vehicle_snapshot?.number_plate}</Text>
            <Text style={styles.label}>Refund amount (₹)</Text>
            <TextInput
              testID="refund-amount-input"
              value={refundAmt}
              onChangeText={(t) => setRefundAmt(t.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              style={styles.input}
              placeholder="e.g. 2000"
              placeholderTextColor={colors.onSurfaceSecondary}
            />
            <Text style={styles.helper}>Deposit on file: ₹{Number(confirming?.vehicle_snapshot?.security_deposit || 0).toFixed(0)}. Any amount not refunded will be recorded as deductions.</Text>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              testID="return-notes-input"
              value={adminNote}
              onChangeText={setAdminNote}
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
              multiline
              placeholder="e.g. Minor scratch on rear panel; \u20b9500 deducted."
              placeholderTextColor={colors.onSurfaceSecondary}
            />
            <Pressable
              testID="submit-confirm-return"
              onPress={submitConfirm}
              disabled={saving || refundAmt === ""}
              style={({ pressed }) => [styles.confirmBtn, (saving || refundAmt === "") && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.confirmText}>Confirm & Release Vehicle</Text>}
            </Pressable>
            <Pressable onPress={() => setConfirming(null)} style={styles.cancelBtn}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function statusLabel(s: string) {
  return s === "return_requested" ? "Return Requested" : s === "active" ? "Active" : s === "returned" ? "Returned" : s;
}
function statusColor(s: string) {
  if (s === "active") return { backgroundColor: colors.brandTertiary };
  if (s === "return_requested") return { backgroundColor: colors.warning + "22" };
  if (s === "returned") return { backgroundColor: colors.brandSecondary };
  return { backgroundColor: colors.surfaceSecondary };
}
function statusTextColor(s: string) {
  if (s === "active") return { color: colors.brandPrimary };
  if (s === "return_requested") return { color: colors.warning };
  if (s === "returned") return { color: colors.onBrandSecondary };
  return { color: colors.onSurfaceSecondary };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: type.sm },
  tabTextActive: { color: colors.brandPrimary },
  card: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rider: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  phone: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: type.sm, fontWeight: "700" },
  vehLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  vehText: { color: colors.onSurface, fontSize: type.base, fontWeight: "600" },
  specRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  spec: { color: colors.onSurfaceSecondary, fontSize: type.sm },
  noteBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  noteLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  noteText: { color: colors.onSurface, fontSize: type.base },
  depositRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.xs },
  depTxt: { color: colors.onSurfaceSecondary, fontSize: type.sm },
  cta: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, height: 44, borderRadius: radius.md },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700" },
  ctaGhost: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  ctaGhostText: { color: colors.brandPrimary, fontWeight: "700" },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: spacing.xs },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: type.base, color: colors.onSurface, minHeight: 48, backgroundColor: colors.surface },
  helper: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 4 },
  confirmBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  confirmText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  cancelBtn: { height: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
});
