import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type P = any;
type U = any;

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
];

export default function AdminPayments() {
  const [payments, setPayments] = useState<P[]>([]);
  const [users, setUsers] = useState<U[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<P | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (debounced) params.set("q", debounced);
      const [p, u] = await Promise.all([
        api<P[]>(`/admin/payments?${params.toString()}`),
        api<U[]>("/admin/users"),
      ]);
      setPayments(p);
      setUsers(u);
    } catch {} finally { setLoading(false); }
  }, [status, debounced]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const userMap: Record<string, U> = {};
  users.forEach((u) => { userMap[u.id] = u; });
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);
  const totalPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-payments">
      <View style={styles.header}>
        <Text style={styles.h1}>Payments</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.onSurfaceSecondary} />
          <TextInput
            testID="payments-search-input"
            value={search}
            onChangeText={setSearch}
            placeholder="Search by rider, phone or txn ID..."
            placeholderTextColor={colors.onSurfaceSecondary}
            style={styles.searchInput}
          />
          {search ? (
            <Pressable testID="payments-search-clear" onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {STATUS_TABS.map((t) => (
            <Pressable key={t.key || "all"} testID={`payments-tab-${t.key || "all"}`} onPress={() => setStatus(t.key)} style={[styles.tab, status === t.key && styles.tabActive]}>
              <Text style={[styles.tabText, status === t.key && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={[styles.summary, shadow.card]}>
        <View style={styles.summaryHalf}>
          <Text style={styles.summaryLabel}>Earned (filtered)</Text>
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
        ListEmptyComponent={<Text style={styles.muted}>No payments match.</Text>}
        renderItem={({ item }) => {
          const u = userMap[item.user_id];
          const fee = Number(item.late_fee || 0);
          const total = Number(item.amount) + fee;
          return (
            <Pressable onPress={() => setEditing(item)} style={[styles.row, shadow.card]} testID={`payment-row-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.amt}>₹{total.toFixed(0)}</Text>
                {fee > 0 && <Text style={styles.feeBreak}>₹{Number(item.amount).toFixed(0)} + <Text style={{ color: colors.error, fontWeight: "700" }}>₹{fee.toFixed(0)} late</Text></Text>}
                <Text style={styles.meta}>{u?.full_name || `+91 ${u?.phone || "?"}`} · {new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</Text>
                {item.transaction_id ? <Text style={styles.txn}>Txn: {item.transaction_id}</Text> : null}
              </View>
              <View style={[styles.chip, { backgroundColor: item.status === "paid" ? colors.brandSecondary : (fee > 0 ? colors.error + "22" : colors.warning + "22") }]}>
                <Text style={[styles.chipText, { color: item.status === "paid" ? colors.onBrandSecondary : (fee > 0 ? colors.error : colors.warning) }]}>
                  {item.status === "paid" ? "Paid" : (fee > 0 ? "Overdue" : "Pending")}
                </Text>
              </View>
              <Ionicons name="create-outline" size={18} color={colors.onSurfaceSecondary} style={{ marginLeft: 8 }} />
            </Pressable>
          );
        }}
      />

      <EditPaymentSheet payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </SafeAreaView>
  );
}

function EditPaymentSheet({ payment, onClose, onSaved }: { payment: any | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [lateFee, setLateFee] = useState("");
  const [txn, setTxn] = useState("");
  const [status, setStatus] = useState("pending");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (payment) {
      setAmount(String(payment.amount ?? ""));
      setLateFee(String(payment.late_fee ?? 0));
      setTxn(payment.transaction_id || "");
      setStatus(payment.status || "pending");
      setDueDate(payment.due_date ? payment.due_date.slice(0, 10) : "");
    }
  }, [payment]);

  const save = async () => {
    if (!payment) return;
    setSaving(true);
    try {
      const body: any = {
        amount: Number(amount) || 0,
        late_fee: Number(lateFee) || 0,
        status,
        transaction_id: txn || null,
      };
      if (dueDate) body.due_date = new Date(dueDate + "T00:00:00Z").toISOString();
      await api(`/admin/payments/${payment.id}`, { method: "PUT", body });
      onSaved();
    } catch (e: any) { alert(e?.message || "Save failed"); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!payment) return;
    try { await api(`/admin/payments/${payment.id}`, { method: "DELETE" }); onSaved(); } catch {}
  };

  const markCash = async () => {
    if (!payment) return;
    setSaving(true);
    try {
      await api(`/admin/payments/${payment.id}/mark-paid-cash`, { method: "POST", body: {} });
      onSaved();
    } catch (e: any) { alert(e?.message || "Could not mark cash payment"); } finally { setSaving(false); }
  };

  return (
    <Modal visible={!!payment} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.sheetTitle}>Edit Payment</Text>
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput testID="edit-amount" value={amount} onChangeText={setAmount} keyboardType="numeric" style={styles.input} placeholderTextColor={colors.onSurfaceSecondary} />
            <Text style={styles.label}>Late Fee (₹)</Text>
            <TextInput testID="edit-late-fee" value={lateFee} onChangeText={setLateFee} keyboardType="numeric" style={styles.input} placeholderTextColor={colors.onSurfaceSecondary} />
            <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
            <TextInput testID="edit-due-date" value={dueDate} onChangeText={setDueDate} placeholder="2026-07-15" placeholderTextColor={colors.onSurfaceSecondary} style={styles.input} autoCapitalize="none" />
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusRow}>
              {["pending", "paid", "failed"].map((s) => (
                <Pressable key={s} testID={`edit-status-${s}`} onPress={() => setStatus(s)} style={[styles.statusBtn, status === s && styles.statusBtnActive]}>
                  <Text style={[styles.statusBtnText, status === s && styles.statusBtnTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Transaction ID</Text>
            <TextInput testID="edit-txn" value={txn} onChangeText={setTxn} placeholder="e.g. 491829374829" placeholderTextColor={colors.onSurfaceSecondary} style={styles.input} />
            <Pressable testID="save-payment" onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Changes</Text>}
            </Pressable>
            {payment?.status === "pending" ? (
              <Pressable testID="mark-cash-paid-button" onPress={markCash} disabled={saving} style={({ pressed }) => [styles.cashBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}>
                <Ionicons name="cash" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.saveText}>Mark Paid (Cash)</Text>
              </Pressable>
            ) : null}
            <Pressable testID="delete-payment" onPress={remove} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>Delete Payment</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontSize: type.base, color: colors.onSurface, paddingVertical: 0 },
  tabs: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: type.sm },
  tabTextActive: { color: colors.brandPrimary },
  summary: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, flexDirection: "row", alignItems: "center" },
  summaryHalf: { flex: 1 },
  summaryLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: type.sm },
  summaryAmt: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: "800", marginTop: 2 },
  summaryDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.2)" },
  row: { flexDirection: "row", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, alignItems: "center" },
  amt: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  feeBreak: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  meta: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  txn: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  chipText: { fontWeight: "700", fontSize: type.sm, textTransform: "capitalize" },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 48, fontSize: type.base, color: colors.onSurface },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  statusBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  statusBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  statusBtnText: { color: colors.onSurface, fontWeight: "700", textTransform: "capitalize" },
  statusBtnTextActive: { color: colors.onBrandPrimary },
  saveBtn: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  cashBtn: { marginTop: spacing.sm, flexDirection: "row", gap: 8, backgroundColor: "#2a7e3c", height: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  deleteBtn: { marginTop: spacing.sm, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.error },
  deleteText: { color: colors.error, fontWeight: "700" },
  cancelBtn: { paddingVertical: spacing.md, alignItems: "center" },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
});
