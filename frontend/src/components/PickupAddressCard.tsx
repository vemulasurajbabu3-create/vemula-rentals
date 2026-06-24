import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type PublicSettings = {
  business_phone?: string;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  merchant_name?: string;
};

export default function PickupAddressCard({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<PublicSettings | null>(null);

  useEffect(() => {
    (async () => {
      try { setS(await api<PublicSettings>("/settings/public")); } catch {}
    })();
  }, []);

  if (!s) return null;
  const lat = Number(s.pickup_lat || 0);
  const lng = Number(s.pickup_lng || 0);
  const hasCoords = !!(lat && lng);
  const label = s.pickup_address || "Vemula Rentals — Pickup Point";

  const openMaps = async () => {
    if (!hasCoords) return;
    // Use Google Maps URL — opens in the Google Maps app on Android (or the Maps app on iOS),
    // or in the browser on web. Falls back gracefully.
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const appleMaps = `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`;
    const url = Platform.OS === "ios" ? appleMaps : gmaps;
    try { await Linking.openURL(url); } catch {
      try { await Linking.openURL(gmaps); } catch {}
    }
  };

  const callBusiness = async () => {
    if (!s.business_phone) return;
    const num = s.business_phone.replace(/[^0-9+]/g, "");
    try { await Linking.openURL(`tel:${num}`); } catch {}
  };

  return (
    <View style={[styles.card, compact && styles.cardCompact, shadow.card]} testID="pickup-address-card">
      <View style={styles.iconWrap}>
        <Ionicons name="location" size={20} color={colors.onBrandPrimary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>Pickup & Drop-off</Text>
        <Text style={styles.address} numberOfLines={compact ? 1 : 2}>{label}</Text>
        {!compact && hasCoords ? (
          <Text style={styles.coords} testID="pickup-coords">{`${lat.toFixed(5)}, ${lng.toFixed(5)}`}</Text>
        ) : null}
      </View>
      <View style={styles.actionsCol}>
        {hasCoords && (
          <Pressable testID="open-in-maps-button" onPress={openMaps} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="navigate" size={16} color={colors.brandPrimary} />
            <Text style={styles.btnText}>Directions</Text>
          </Pressable>
        )}
        {s.business_phone ? (
          <Pressable testID="call-business-button" onPress={callBusiness} style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.85 }]}>
            <Ionicons name="call" size={16} color={colors.onSurface} />
            <Text style={styles.btnGhostText}>Call</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, alignItems: "center" },
  cardCompact: { padding: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  label: { color: colors.brandPrimary, fontSize: type.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  address: { color: colors.onSurface, fontSize: type.base, fontWeight: "600", marginTop: 2 },
  coords: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  actionsCol: { gap: 6 },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  btnText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.sm },
  btnGhost: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.onSurface, fontWeight: "700", fontSize: type.sm },
});
