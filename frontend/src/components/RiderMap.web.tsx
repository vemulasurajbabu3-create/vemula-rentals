import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, type } from "@/src/theme";

export type Pin = { id: string; latitude: number; longitude: number; title?: string; description?: string };

type Props = { pins: Pin[] };

export default function RiderMap({ pins }: Props) {
  return (
    <View style={styles.container} testID="rider-map-web">
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={colors.brandPrimary} />
        <Text style={styles.noticeText}>Interactive map is available in the mobile app build. Showing rider locations as a list.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {pins.length === 0 ? (
          <Text style={styles.empty}>No rider locations yet.</Text>
        ) : pins.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.pin}><Ionicons name="location" size={18} color={colors.onBrandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.coords}>{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</Text>
              {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  notice: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.brandTertiary, marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md, alignItems: "center" },
  noticeText: { flex: 1, color: colors.brandPrimary, fontSize: type.sm, fontWeight: "600" },
  empty: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  pin: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "700", color: colors.onSurface, fontSize: type.base },
  coords: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  desc: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
});
