import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { callBusiness, whatsappBusiness } from "@/src/components/BusinessContact";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type U = any;
type V = any;

const TABS: { key: string; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
  { key: "rejected", label: "Rejected" },
];

export default function AdminUsers() {
  const [users, setUsers] = useState<U[]>([]);
  const [vehicles, setVehicles] = useState<V[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<U | null>(null);
  const [tab, setTab] = useState<string>("approved");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState<string>("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("status", tab);
      if (debounced) params.set("q", debounced);
      const [u, v] = await Promise.all([
        api<U[]>(`/admin/users?${params.toString()}`),
        api<V[]>("/vehicles"),
      ]);
      setUsers(u);
      setVehicles(v);
    } catch {} finally { setLoading(false); }
  }, [tab, debounced]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approve = async (id: string) => {
    setBusy(id);
    try { await api(`/admin/users/${id}/approve`, { method: "POST" }); await load(); } catch {} finally { setBusy(""); }
  };
  const reject = async (id: string) => {
    setBusy(id);
    try { await api(`/admin/users/${id}/reject`, { method: "POST" }); await load(); } catch {} finally { setBusy(""); }
  };
  const assign = async (vid: string) => {
    if (!assignFor) return;
    try {
      await api("/vehicles/assign", { method: "POST", body: { user_id: assignFor.id, vehicle_id: vid } });
      setAssignFor(null); load();
    } catch (e: any) {
      // surface 412 deposit error nicely (admin can prompt user)
      setAssignFor(null);
      alert(e?.message || "Assign failed");
    }
  };
  const forfeit = async (uid: string, balance: number) => {
    const a = window.prompt?.(`Forfeit how much from ₹${balance.toFixed(0)} deposit?`, "500");
    if (!a) return;
    const amt = Number(a);
    if (!amt || amt <= 0) return;
    const reason = window.prompt?.("Reason?", "Overdue payment") || "Overdue payment";
    try {
      await api(`/admin/users/${uid}/forfeit-deposit`, { method: "POST", body: { amount: amt, reason } });
      load();
    } catch (e: any) { alert(e?.message || "Forfeit failed"); }
  };

  const availableV = useMemo(() => vehicles.filter((v) => !v.assigned_to || v.assigned_to === assignFor?.id), [vehicles, assignFor]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-users">
      <View style={styles.header}>
        <Text style={styles.h1}>Users</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.onSurfaceSecondary} />
          <TextInput
            testID="users-search-input"
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, phone, address..."
            placeholderTextColor={colors.onSurfaceSecondary}
            style={styles.searchInput}
          />
          {search ? (
            <Pressable testID="users-search-clear" onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} testID={`users-tab-${t.key}`} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={users.filter((u) => !u.is_admin)}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<Text style={styles.muted}>No users in this tab.</Text>}
        renderItem={({ item }) => {
          const isPending = item.status === "pending";
          const isRejected = item.status === "rejected";
          return (
            <View style={[styles.card, shadow.card]} testID={`user-${item.id}`}>
              <View style={styles.cardTop}>
                <View style={styles.avatar}><Ionicons name="person" color={colors.onBrandPrimary} size={20} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.full_name || "Unnamed Rider"}</Text>
                  <Text style={styles.phone}>+91 {item.phone}</Text>
                  {item.address ? <Text style={styles.meta} numberOfLines={1}>{item.address}</Text> : null}
                  {item.assigned_vehicle ? (
                    <Text style={styles.assigned}>{item.assigned_vehicle.model} · {item.assigned_vehicle.number_plate}</Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>Deposit: <Text style={{ fontWeight: "700", color: colors.onSurface }}>₹{Number(item.deposit_balance || 0).toFixed(0)}</Text></Text>
                    {item.last_location ? <Text style={styles.meta}>· {item.last_location.latitude.toFixed(2)}, {item.last_location.longitude.toFixed(2)}</Text> : null}
                  </View>
                </View>
                <View style={[styles.statusChip, { backgroundColor: isPending ? colors.warning + "22" : isRejected ? colors.error + "22" : colors.brandSecondary }]}>
                  <Text style={[styles.statusText, { color: isPending ? colors.warning : isRejected ? colors.error : colors.onBrandSecondary }]}>{item.status || "approved"}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                {isPending && (
                  <>
                    <Pressable testID={`approve-${item.id}`} onPress={() => approve(item.id)} disabled={busy === item.id} style={[styles.actBtn, { backgroundColor: colors.brandPrimary }]}>
                      {busy === item.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={[styles.actText, { color: colors.onBrandPrimary }]}>Approve</Text>}
                    </Pressable>
                    <Pressable testID={`reject-${item.id}`} onPress={() => reject(item.id)} style={[styles.actBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
                      <Text style={[styles.actText, { color: colors.error }]}>Reject</Text>
                    </Pressable>
                  </>
                )}
                {item.status === "approved" && (
                  <>
                    <Pressable testID={`assign-${item.id}`} onPress={() => setAssignFor(item)} style={[styles.actBtn, { backgroundColor: colors.brandPrimary }]}>
                      <Text style={[styles.actText, { color: colors.onBrandPrimary }]}>{item.assigned_vehicle ? "Change Vehicle" : "Assign Vehicle"}</Text>
                    </Pressable>
                    {Number(item.deposit_balance || 0) > 0 && (
                      <Pressable testID={`forfeit-${item.id}`} onPress={() => forfeit(item.id, Number(item.deposit_balance || 0))} style={[styles.actBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error }]}>
                        <Text style={[styles.actText, { color: colors.error }]}>Forfeit</Text>
                      </Pressable>
                    )}
                  </>
                )}
                <Pressable testID={`call-${item.id}`} onPress={callBusiness} style={[styles.actBtnIcon]}>
                  <Ionicons name="call" size={16} color={colors.brandPrimary} />
                </Pressable>
                <Pressable testID={`wa-${item.id}`} onPress={() => whatsappBusiness(`Hi, regarding rider +91 ${item.phone}`)} style={[styles.actBtnIcon]}>
                  <Ionicons name="logo-whatsapp" size={16} color={colors.brandPrimary} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Assign Vehicle</Text>
            <Text style={styles.sheetBody}>
              Pick a vehicle for {assignFor?.full_name || `+91 ${assignFor?.phone}`}. Deposit balance: ₹{Number(assignFor?.deposit_balance || 0).toFixed(0)}.
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {availableV.length === 0 ? (
                <Text style={styles.muted}>No available vehicles.</Text>
              ) : availableV.map((v) => {
                const dep = Number(v.security_deposit || 0);
                const bal = Number(assignFor?.deposit_balance || 0);
                const shortfall = Math.max(0, dep - bal);
                return (
                  <Pressable key={v.id} testID={`assign-v-${v.id}`} onPress={() => assign(v.id)} style={({ pressed }) => [styles.vRow, pressed && { backgroundColor: colors.surfaceSecondary }, shortfall > 0 && { borderColor: colors.warning, borderWidth: 1 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.vModel}>{v.model}</Text>
                      <Text style={styles.vPlate}>{v.number_plate} · ₹{v.weekly_rent}/wk · Deposit ₹{dep.toFixed(0)}</Text>
                      {shortfall > 0 && <Text style={{ color: colors.warning, fontSize: type.sm, marginTop: 2 }}>Customer needs to pay ₹{shortfall.toFixed(0)} more deposit</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
  card: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  phone: { color: colors.onSurfaceSecondary, marginTop: 2 },
  meta: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  metaRow: { flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap" },
  assigned: { color: colors.brandPrimary, marginTop: 4, fontWeight: "600", fontSize: type.sm },
  statusChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: type.sm, fontWeight: "700", textTransform: "capitalize" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, flexWrap: "wrap" },
  actBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  actBtnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  actText: { fontWeight: "700", fontSize: type.sm },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  sheetBody: { color: colors.onSurfaceSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  vRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, marginBottom: spacing.sm },
  vModel: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  vPlate: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
});
