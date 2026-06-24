import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

const MERCHANT_VPA = "vemularentals@upi";
const MERCHANT_NAME = "Vemula Rentals";

type Payment = any;

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deposit, setDeposit] = useState<{ balance: number; history: any[] }>({ balance: 0, history: [] });
  const [requiredDeposit, setRequiredDeposit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activePay, setActivePay] = useState<Payment | null>(null);
  const [activeDeposit, setActiveDeposit] = useState<any | null>(null);
  const [txn, setTxn] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, d, v] = await Promise.all([
        api<Payment[]>("/payments/me"),
        api<{ balance: number; history: any[] }>("/deposits/me"),
        api<any | null>("/users/me/vehicle"),
      ]);
      setPayments(p); setDeposit(d);
      setRequiredDeposit(v?.security_deposit ? Number(v.security_deposit) : 0);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pending = payments.filter((p) => p.status === "pending");
  const pendingTotal = pending.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);

  const openUpi = async (p: Payment) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const total = Number(p.amount) + Number(p.late_fee || 0);
    const url = `upi://pay?pa=${encodeURIComponent(MERCHANT_VPA)}&pn=${encodeURIComponent(MERCHANT_NAME)}&am=${total}&tn=${encodeURIComponent("Weekly Rent " + p.id.slice(0, 6))}&cu=INR`;
    setActivePay(p); setTxn("");
    if (Platform.OS !== "web") {
      try { const ok = await Linking.canOpenURL(url); if (ok) await Linking.openURL(url); } catch {}
    }
  };

  const confirmPaid = async () => {
    if (!activePay || !txn.trim()) return;
    setConfirming(true);
    try {
      await api(`/payments/${activePay.id}/mark-paid`, { method: "POST", body: { transaction_id: txn.trim() } });
      setActivePay(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    } catch {} finally { setConfirming(false); }
  };

  const startDeposit = async (amount: number) => {
    if (amount <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const d = await api<any>("/deposits", { method: "POST", body: { amount } });
    const url = `upi://pay?pa=${encodeURIComponent(MERCHANT_VPA)}&pn=${encodeURIComponent(MERCHANT_NAME)}&am=${amount}&tn=${encodeURIComponent("Security Deposit " + d.id.slice(0, 6))}&cu=INR`;
    setActiveDeposit(d); setTxn("");
    if (Platform.OS !== "web") {
      try { const ok = await Linking.canOpenURL(url); if (ok) await Linking.openURL(url); } catch {}
    }
  };

  const confirmDeposit = async () => {
    if (!activeDeposit || !txn.trim()) return;
    setConfirming(true);
    try {
      await api(`/deposits/${activeDeposit.id}/mark-paid`, { method: "POST", body: { transaction_id: txn.trim() } });
      setActiveDeposit(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    } catch {} finally { setConfirming(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const depositShortfall = Math.max(0, requiredDeposit - deposit.balance);
  const showDepositCard = deposit.balance > 0 || requiredDeposit > 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="payments-screen">
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Payments</Text>
      </View>

      {pending.length > 0 && (
        <View style={[styles.pendingBanner, shadow.card]} testID="pending-banner">
          <View>
            <Text style={styles.pendingLabel}>Pending Balance</Text>
            <Text style={styles.pendingAmount}>₹{pendingTotal.toFixed(0)}</Text>
          </View>
          <Pressable testID="pay-now-banner" onPress={() => openUpi(pending[0])} style={({ pressed }) => [styles.payNow, pressed && { opacity: 0.85 }]}>
            <Ionicons name="flash" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.payNowText}>Pay Now</Text>
          </Pressable>
        </View>
      )}

      {showDepositCard && (
        <View style={[styles.depositCard, shadow.card]} testID="deposit-card">
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="shield-checkmark" size={22} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.depositLabel}>Security Deposit</Text>
            <Text style={styles.depositAmount}>
              ₹{Number(deposit.balance).toFixed(0)}
              {requiredDeposit > 0 && (
                <Text style={styles.depositMuted}>{`  / ₹${requiredDeposit.toFixed(0)}`}</Text>
              )}
            </Text>
            <Text style={styles.depositSub} testID="deposit-sub">
              {depositShortfall > 0
                ? `Pay ₹${depositShortfall.toFixed(0)} to complete your deposit.`
                : requiredDeposit > 0
                ? "Deposit fully paid. Refundable on return."
                : "Refundable on return."}
            </Text>
            {depositShortfall > 0 && (
              <Pressable
                testID="pay-deposit-button"
                onPress={() => startDeposit(depositShortfall)}
                style={({ pressed }) => [styles.depositCta, { marginTop: spacing.sm }, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="flash" size={14} color={colors.onBrandPrimary} />
                <Text style={styles.depositCtaText}>Pay Deposit</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm }}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={42} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No payments yet</Text>
            <Text style={styles.emptyBody}>Once you start rental, your weekly payments will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const fee = Number(item.late_fee || 0);
          const total = Number(item.amount) + fee;
          return (
            <View style={[styles.row, shadow.card]} testID={`payment-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.amount}>₹{total.toFixed(0)}</Text>
                {fee > 0 && (
                  <Text style={styles.feeBreak} testID={`fee-break-${item.id}`}>
                    ₹{Number(item.amount).toFixed(0)} rent + <Text style={{ color: colors.error, fontWeight: "700" }}>₹{fee.toFixed(0)} late fee</Text>
                  </Text>
                )}
                <Text style={styles.metaText}>
                  {item.status === "paid"
                    ? `Paid ${new Date(item.paid_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`
                    : `Due ${new Date(item.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                </Text>
                {item.transaction_id && <Text style={styles.txn}>Txn: {item.transaction_id}</Text>}
              </View>
              <View style={[styles.statusChip, { backgroundColor: item.status === "paid" ? colors.brandSecondary : (fee > 0 ? colors.error + "22" : colors.warning + "22") }]}>
                <Text style={[styles.statusChipText, { color: item.status === "paid" ? colors.onBrandSecondary : (fee > 0 ? colors.error : colors.warning) }]}>
                  {item.status === "paid" ? "Paid" : (fee > 0 ? "Overdue" : "Pending")}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={!!activePay} transparent animationType="slide" onRequestClose={() => setActivePay(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="confirm-payment-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Confirm UPI Payment</Text>
            <Text style={styles.sheetBody}>If your UPI app didnt open, you can still confirm by entering the transaction ID once payment is done.</Text>
            <Text style={styles.label}>Transaction ID</Text>
            <TextInput
              testID="txn-input"
              value={txn}
              onChangeText={setTxn}
              placeholder="e.g. 491829374829"
              placeholderTextColor={colors.onSurfaceSecondary}
              style={styles.txInput}
              autoCapitalize="characters"
            />
            <Pressable
              testID="confirm-payment-button"
              onPress={confirmPaid}
              disabled={!txn.trim() || confirming}
              style={({ pressed }) => [styles.confirmCta, (!txn.trim() || confirming) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              {confirming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.confirmText}>Mark as Paid</Text>}
            </Pressable>
            <Pressable onPress={() => setActivePay(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!activeDeposit} transparent animationType="slide" onRequestClose={() => setActiveDeposit(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Confirm Deposit Payment</Text>
            <Text style={styles.sheetBody}>Once your UPI app shows the payment succeeded, paste the transaction ID below to credit ₹{Number(activeDeposit?.amount || 0).toFixed(0)} to your deposit balance.</Text>
            <Text style={styles.label}>Transaction ID</Text>
            <TextInput
              testID="deposit-txn-input"
              value={txn}
              onChangeText={setTxn}
              placeholder="e.g. 491829374829"
              placeholderTextColor={colors.onSurfaceSecondary}
              style={styles.txInput}
              autoCapitalize="characters"
            />
            <Pressable
              testID="confirm-deposit-button"
              onPress={confirmDeposit}
              disabled={!txn.trim() || confirming}
              style={({ pressed }) => [styles.confirmCta, (!txn.trim() || confirming) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              {confirming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.confirmText}>Credit Deposit</Text>}
            </Pressable>
            <Pressable onPress={() => setActiveDeposit(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  headerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  pendingBanner: { marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pendingLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: type.sm },
  pendingAmount: { color: colors.onBrandPrimary, fontSize: 28, fontWeight: "800", marginTop: 2 },
  payNow: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  payNowText: { color: colors.onBrandPrimary, fontWeight: "700" },
  row: { flexDirection: "row", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, alignItems: "center" },
  amount: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  metaText: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  txn: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  feeBreak: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusChipText: { fontWeight: "700", fontSize: type.sm },
  emptyCard: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  emptyBody: { color: colors.onSurfaceSecondary, textAlign: "center" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  sheetBody: { color: colors.onSurfaceSecondary, fontSize: type.base, marginBottom: spacing.md },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
  txInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 52, fontSize: type.lg, color: colors.onSurface, backgroundColor: colors.surface },
  confirmCta: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  confirmText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  cancelBtn: { height: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  cancelText: { color: colors.onSurfaceSecondary, fontSize: type.base, fontWeight: "600" },
  depositCard: { flexDirection: "row", marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandSecondary, gap: spacing.md, alignItems: "center" },
  depositLabel: { color: colors.brandPrimary, fontSize: type.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  depositAmount: { color: colors.onSurface, fontSize: 26, fontWeight: "800", marginTop: 4 },
  depositMuted: { fontSize: type.base, color: colors.onSurfaceSecondary, fontWeight: "400" },
  depositSub: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 4, lineHeight: 18 },
  depositCta: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, alignSelf: "flex-start" },
  depositCtaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.sm },
});
