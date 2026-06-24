import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

const MERCHANT_VPA_DEFAULT = "vemula.balajee@ybl";
const MERCHANT_NAME_DEFAULT = "Vemula Rentals";

type Payment = any;

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deposit, setDeposit] = useState<{ balance: number; history: any[] }>({ balance: 0, history: [] });
  const [requiredDeposit, setRequiredDeposit] = useState(0);
  const [minDeposit, setMinDeposit] = useState(2000);
  const [merchantUpi, setMerchantUpi] = useState(MERCHANT_VPA_DEFAULT);
  const [merchantName, setMerchantName] = useState(MERCHANT_NAME_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [activePay, setActivePay] = useState<Payment | null>(null);
  const [activeDeposit, setActiveDeposit] = useState<any | null>(null);
  const [txn, setTxn] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, d, v, s] = await Promise.all([
        api<Payment[]>("/payments/me"),
        api<{ balance: number; history: any[] }>("/deposits/me"),
        api<any | null>("/users/me/vehicle"),
        api<{ min_deposit: number; merchant_upi?: string; merchant_name?: string }>("/settings/public").catch(() => ({ min_deposit: 2000 } as any)),
      ]);
      setPayments(p); setDeposit(d);
      setRequiredDeposit(v?.security_deposit ? Number(v.security_deposit) : 0);
      setMinDeposit(Number(s?.min_deposit ?? 2000));
      if (s?.merchant_upi) setMerchantUpi(s.merchant_upi);
      if (s?.merchant_name) setMerchantName(s.merchant_name);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pending = payments.filter((p) => p.status === "pending");
  const pendingTotal = pending.reduce((s, p) => s + Number(p.amount) + Number(p.late_fee || 0), 0);

  const openUpi = async (p: Payment) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const total = Number(p.amount) + Number(p.late_fee || 0);
    const url = `upi://pay?pa=${encodeURIComponent(merchantUpi)}&pn=${encodeURIComponent(merchantName)}&am=${total}&tn=${encodeURIComponent("Weekly Rent " + p.id.slice(0, 6))}&cu=INR`;
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
    const url = `upi://pay?pa=${encodeURIComponent(merchantUpi)}&pn=${encodeURIComponent(merchantName)}&am=${amount}&tn=${encodeURIComponent("Security Deposit " + d.id.slice(0, 6))}&cu=INR`;
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

  const targetDeposit = requiredDeposit > 0 ? requiredDeposit : minDeposit;
  const depositShortfall = Math.max(0, targetDeposit - deposit.balance);
  const helperText = useMemo(() => {
    if (requiredDeposit > 0) {
      return depositShortfall > 0
        ? `Top up ₹${depositShortfall.toFixed(0)} to fully cover the deposit for your assigned vehicle.`
        : "Deposit fully covered. Refundable on return (after damages, if any).";
    }
    if (deposit.balance <= 0) {
      return `Maintain at least ₹${minDeposit.toFixed(0)} in your wallet so the business can assign you a vehicle.`;
    }
    if (depositShortfall > 0) {
      return `Add ₹${depositShortfall.toFixed(0)} to reach the recommended ₹${minDeposit.toFixed(0)} wallet balance.`;
    }
    return "Your wallet covers the recommended deposit. The business can assign you a vehicle anytime.";
  }, [requiredDeposit, deposit.balance, depositShortfall, minDeposit]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const presetAmounts = [500, 1000, 2000, 5000];

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

      <View style={[styles.walletCard, shadow.card]} testID="deposit-card">
        <View style={styles.walletHeaderRow}>
          <View style={styles.walletIconWrap}>
            <Ionicons name="wallet" size={22} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletLabel}>Security Deposit Wallet</Text>
            <Text style={styles.walletAmount} testID="wallet-balance">
              ₹{Number(deposit.balance).toFixed(0)}
              <Text style={styles.walletMuted}>{`  / ₹${targetDeposit.toFixed(0)} ${requiredDeposit > 0 ? "required" : "recommended"}`}</Text>
            </Text>
          </View>
          {depositShortfall > 0 ? (
            <View style={[styles.statusChip, { backgroundColor: colors.warning + "22" }]}>
              <Text style={[styles.statusChipText, { color: colors.warning }]}>Top up</Text>
            </View>
          ) : (
            <View style={[styles.statusChip, { backgroundColor: colors.brandSecondary }]}>
              <Text style={[styles.statusChipText, { color: colors.onBrandSecondary }]}>Funded</Text>
            </View>
          )}
        </View>

        <View style={styles.walletProgressTrack}>
          <View style={[styles.walletProgressFill, { width: `${Math.min(100, (deposit.balance / Math.max(1, targetDeposit)) * 100).toFixed(0)}%` }]} />
        </View>

        <Text style={styles.walletHelper} testID="deposit-sub">{helperText}</Text>

        <View style={styles.walletButtonRow}>
          {depositShortfall > 0 && (
            <Pressable
              testID="pay-deposit-button"
              onPress={() => startDeposit(depositShortfall)}
              style={({ pressed }) => [styles.depositCta, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="flash" size={14} color={colors.onBrandPrimary} />
              <Text style={styles.depositCtaText}>{`Pay ₹${depositShortfall.toFixed(0)}`}</Text>
            </Pressable>
          )}
          <Pressable
            testID="top-up-button"
            onPress={() => { setTopUpAmount(""); setTopUpOpen(true); }}
            style={({ pressed }) => [styles.topUpCta, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add-circle" size={14} color={colors.brandPrimary} />
            <Text style={styles.topUpCtaText}>Top Up Wallet</Text>
          </Pressable>
        </View>
      </View>

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

      <Modal visible={topUpOpen} transparent animationType="slide" onRequestClose={() => setTopUpOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="top-up-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Top Up Wallet</Text>
            <Text style={styles.sheetBody}>Add any amount to your security deposit wallet. The business holds this balance until you return the vehicle.</Text>
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              testID="top-up-input"
              value={topUpAmount}
              onChangeText={(t) => setTopUpAmount(t.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 1000"
              placeholderTextColor={colors.onSurfaceSecondary}
              style={styles.txInput}
              keyboardType="numeric"
            />
            <View style={styles.presetRow}>
              {presetAmounts.map((amt) => (
                <Pressable
                  key={amt}
                  testID={`preset-${amt}`}
                  onPress={() => setTopUpAmount(String(amt))}
                  style={({ pressed }) => [styles.presetChip, pressed && { opacity: 0.85 }, topUpAmount === String(amt) && styles.presetChipActive]}
                >
                  <Text style={[styles.presetText, topUpAmount === String(amt) && styles.presetTextActive]}>{`₹${amt}`}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              testID="confirm-top-up-button"
              onPress={() => {
                const n = Number(topUpAmount);
                if (!Number.isFinite(n) || n <= 0) return;
                setTopUpOpen(false);
                startDeposit(n);
              }}
              disabled={!Number(topUpAmount) || Number(topUpAmount) <= 0}
              style={({ pressed }) => [styles.confirmCta, (!Number(topUpAmount) || Number(topUpAmount) <= 0) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.confirmText}>Continue to UPI</Text>
            </Pressable>
            <Pressable onPress={() => setTopUpOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
  walletCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, gap: spacing.sm },
  walletHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  walletIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  walletLabel: { color: colors.brandPrimary, fontSize: type.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  walletAmount: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 4 },
  walletMuted: { fontSize: type.sm, color: colors.onSurfaceSecondary, fontWeight: "500" },
  walletProgressTrack: { marginTop: spacing.sm, height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  walletProgressFill: { height: 6, backgroundColor: colors.brandPrimary },
  walletHelper: { color: colors.onSurfaceSecondary, fontSize: type.sm, lineHeight: 18, marginTop: 4 },
  walletButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  topUpCta: { flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  topUpCtaText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.sm },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  presetChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  presetChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  presetText: { color: colors.onSurface, fontWeight: "700", fontSize: type.sm },
  presetTextActive: { color: colors.brandPrimary },
});
