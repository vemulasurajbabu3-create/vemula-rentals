import { View, Text, StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { colors, spacing, type } from "@/src/theme";

export type Pin = { id: string; latitude: number; longitude: number; title?: string; description?: string };

type Props = { pins: Pin[] };

export default function RiderMap({ pins }: Props) {
  const first = pins[0];
  const initialRegion = first
    ? { latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : { latitude: 12.9716, longitude: 77.5946, latitudeDelta: 1, longitudeDelta: 1 }; // Bangalore fallback

  if (pins.length === 0) {
    return (
      <View style={styles.empty} testID="map-empty">
        <Text style={styles.emptyTitle}>No locations yet</Text>
        <Text style={styles.emptyBody}>Customer locations will show here once they enable location sharing.</Text>
      </View>
    );
  }

  return (
    <MapView style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={initialRegion} testID="rider-map">
      {pins.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.latitude, longitude: p.longitude }}
          title={p.title}
          description={p.description}
          pinColor={colors.brandPrimary}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptyBody: { color: colors.onSurfaceSecondary, textAlign: "center" },
});
