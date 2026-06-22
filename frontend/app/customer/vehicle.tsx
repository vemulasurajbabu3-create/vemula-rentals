import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function VehicleScreen() {
  const [vehicle, setVehicle] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      try { setVehicle(await api("/users/me/vehicle")); } catch {} finally { setLoading(false); }
    })();
  }, []));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  if (!vehicle) {
    return (
      <SafeAreaView style={styles.empty} edges={["top"]} testID="vehicle-empty">
        <Ionicons name="bicycle-outline" size={64} color={colors.onSurfaceSecondary} />
        <Text style={styles.emptyTitle}>No vehicle assigned</Text>
        <Text style={styles.emptyBody}>Contact the rental business to get your vehicle assigned.</Text>
      </SafeAreaView>
    );
  }

  const startDate = vehicle.rental_start_date ? new Date(vehicle.rental_start_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <View style={styles.container} testID="vehicle-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={styles.hero}>
          {vehicle.image_url ? (
            <Image source={{ uri: vehicle.image_url }} style={styles.heroImg} contentFit="cover" />
          ) : (
            <View style={[styles.heroImg, { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary }]}>
              <Ionicons name="bicycle" size={120} color={colors.brandPrimary} />
            </View>
          )}
          <LinearGradient colors={["transparent", "rgba(26,28,26,0.85)"]} style={styles.scrim} />
          <SafeAreaView edges={["top"]} style={styles.heroOverlay}>
            <View style={{ flex: 1 }} />
            <Text style={styles.heroType}>{vehicle.vehicle_type}</Text>
            <Text style={styles.heroModel}>{vehicle.model}</Text>
            <Text style={styles.heroPlate}>{vehicle.number_plate}</Text>
          </SafeAreaView>
        </View>

        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Rental Info</Text>
          <View style={[styles.grid, shadow.card]}>
            <Spec label="Weekly Rent" value={`₹${vehicle.weekly_rent}`} icon="cash-outline" />
            <Spec label="Status" value={vehicle.status} icon="pulse-outline" />
            <Spec label="Start Date" value={startDate} icon="calendar-outline" />
            <Spec label="Type" value={vehicle.vehicle_type} icon="speedometer-outline" />
          </View>

          <Text style={styles.sectionTitle}>How to Use</Text>
          {(vehicle.instructions || []).length === 0 ? (
            <Text style={styles.muted}>No instructions provided.</Text>
          ) : (
            (vehicle.instructions || []).map((step: string, idx: number) => (
              <View key={idx} style={[styles.stepCard, shadow.card]} testID={`instruction-${idx}`}>
                <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>{idx + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Spec({ label, value, icon }: { label: string; value: string; icon: any }) {
  return (
    <View style={styles.specBox}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.surface, gap: spacing.sm },
  emptyTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface },
  emptyBody: { fontSize: type.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  hero: { height: 320, width: "100%", position: "relative", backgroundColor: colors.surfaceTertiary },
  heroImg: { ...StyleSheet.absoluteFillObject as any },
  scrim: { ...StyleSheet.absoluteFillObject as any },
  heroOverlay: { flex: 1, padding: spacing.lg, justifyContent: "flex-end" },
  heroType: { color: colors.onBrandPrimary, fontSize: type.sm, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1 },
  heroModel: { color: colors.onBrandPrimary, fontSize: 28, fontWeight: "800", marginTop: 2 },
  heroPlate: { color: colors.onBrandPrimary, fontSize: type.lg, marginTop: 4, opacity: 0.9 },
  content: { padding: spacing.lg },
  sectionTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md, marginTop: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, padding: spacing.sm },
  specBox: { width: "50%", padding: spacing.md, gap: 4 },
  specLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary },
  specValue: { fontSize: type.base, fontWeight: "700", color: colors.onSurface, textTransform: "capitalize" },
  stepCard: { flexDirection: "row", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, marginBottom: spacing.sm, alignItems: "center" },
  stepBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepBadgeText: { color: colors.brandPrimary, fontWeight: "800" },
  stepText: { flex: 1, color: colors.onSurface, fontSize: type.base, lineHeight: 20 },
  muted: { color: colors.onSurfaceSecondary, fontSize: type.base },
});
