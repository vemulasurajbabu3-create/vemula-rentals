import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RiderMap, { Pin } from "@/src/components/RiderMap";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type } from "@/src/theme";

export default function AdminMap() {
  const router = useRouter();
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const users = await api<any[]>("/admin/users");
      const customers = users.filter((u) => !u.is_admin);
      setCount(customers.length);
      const out: Pin[] = [];
      for (const u of customers) {
        if (u.last_location && typeof u.last_location.latitude === "number") {
          out.push({
            id: u.id,
            latitude: u.last_location.latitude,
            longitude: u.last_location.longitude,
            title: u.full_name || `+91 ${u.phone}`,
            description: u.assigned_vehicle ? `${u.assigned_vehicle.model} · ${u.assigned_vehicle.number_plate}` : "No vehicle assigned",
          });
        }
      }
      setPins(out);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-map-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="map-back" style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rider Locations</Text>
          <Text style={styles.sub}>{pins.length} of {count} customers sharing live location</Text>
        </View>
        <Pressable onPress={load} testID="map-refresh" style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={colors.brandPrimary} />
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        <RiderMap pins={pins} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  back: { padding: spacing.sm },
  title: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  sub: { color: colors.onSurfaceSecondary, fontSize: type.sm },
  refreshBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandTertiary },
});
