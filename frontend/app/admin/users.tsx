import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type U = any;
type V = any;

export default function AdminUsers() {
  const [users, setUsers] = useState<U[]>([]);
  const [vehicles, setVehicles] = useState<V[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<U | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, v] = await Promise.all([api<U[]>("/admin/users"), api<V[]>("/vehicles")]);
      setUsers(u);
      setVehicles(v);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const assign = async (vid: string) => {
    if (!assignFor) return;
    await api("/vehicles/assign", { method: "POST", body: { user_id: assignFor.id, vehicle_id: vid } });
    setAssignFor(null);
    load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const availableV = vehicles.filter((v) => !v.assigned_to || v.assigned_to === assignFor?.id);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-users">
      <View style={styles.header}><Text style={styles.h1}>Users</Text></View>
      <FlatList
        data={users.filter((u) => !u.is_admin)}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<Text style={styles.muted}>No customers yet.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, shadow.card]} testID={`user-${item.id}`}>
            <View style={styles.avatar}><Ionicons name="person" color={colors.onBrandPrimary} size={20} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.full_name || "Unnamed Rider"}</Text>
              <Text style={styles.phone}>+91 {item.phone}</Text>
              {item.address ? <Text style={styles.meta} numberOfLines={1}><Ionicons name="location" size={12} color={colors.onSurfaceSecondary} /> {item.address}</Text> : null}
              {item.assigned_vehicle ? (
                <Text style={styles.assigned}>🛵 {item.assigned_vehicle.model} · {item.assigned_vehicle.number_plate}</Text>
              ) : (
                <Text style={styles.unassigned}>No vehicle assigned</Text>
              )}
              {item.last_location ? (
                <Text style={styles.meta}>📍 {item.last_location.latitude.toFixed(3)}, {item.last_location.longitude.toFixed(3)}</Text>
              ) : null}
            </View>
            <Pressable testID={`assign-${item.id}`} onPress={() => setAssignFor(item)} style={styles.assignBtn}>
              <Ionicons name="bicycle" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.assignText}>{item.assigned_vehicle ? "Change" : "Assign"}</Text>
            </Pressable>
          </View>
        )}
      />

      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Assign Vehicle</Text>
            <Text style={styles.sheetBody}>Pick a vehicle for {assignFor?.full_name || assignFor?.phone}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {availableV.length === 0 ? (
                <Text style={styles.muted}>No available vehicles. Free one up or add a new vehicle.</Text>
              ) : availableV.map((v) => (
                <Pressable key={v.id} testID={`assign-v-${v.id}`} onPress={() => assign(v.id)} style={({ pressed }) => [styles.vRow, pressed && { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vModel}>{v.model}</Text>
                    <Text style={styles.vPlate}>{v.number_plate} · ₹{v.weekly_rent}/wk</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
                </Pressable>
              ))}
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  card: { flexDirection: "row", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, gap: spacing.md, alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  phone: { color: colors.onSurfaceSecondary, marginTop: 2 },
  meta: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  assigned: { color: colors.brandPrimary, marginTop: 4, fontWeight: "600", fontSize: type.sm },
  unassigned: { color: colors.warning, marginTop: 4, fontWeight: "600", fontSize: type.sm },
  assignBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  assignText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.sm },
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
