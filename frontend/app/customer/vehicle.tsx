import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Platform, Pressable, Linking, Modal, KeyboardAvoidingView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function VehicleScreen() {
  const [vehicle, setVehicle] = useState<any | null>(null);
  const [booking, setBooking] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [notes, setNotes] = useState("");
  const player = useVideoPlayer(vehicle?.walk_around_video || "", (p) => { p.loop = false; });

  const load = useCallback(async () => {
    try {
      const [v, bs] = await Promise.all([
        api<any>("/users/me/vehicle"),
        api<any[]>("/bookings/me").catch(() => []),
      ]);
      setVehicle(v);
      const active = (bs || []).find((b: any) => b.status === "active" || b.status === "return_requested") || null;
      setBooking(active);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requestReturn = async () => {
    setSubmitting(true);
    try {
      await api("/bookings/me/request-return", { method: "POST", body: { notes: notes.trim() || undefined } });
      setShowModal(false);
      setNotes("");
      await load();
    } catch {} finally { setSubmitting(false); }
  };

  const cancelReturn = async () => {
    setSubmitting(true);
    try {
      await api("/bookings/me/cancel-return", { method: "POST", body: {} });
      await load();
    } catch {} finally { setSubmitting(false); }
  };

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

          {vehicle.walk_around_video ? (
            <>
              <Text style={styles.sectionTitle}>Walk-around Video</Text>
              {Platform.OS === "web" ? (
                <Pressable testID="open-video-web" onPress={() => Linking.openURL(vehicle.walk_around_video)} style={[styles.videoFallback, shadow.card]}>
                  <Ionicons name="play-circle" size={48} color={colors.brandPrimary} />
                  <Text style={styles.videoFallbackText}>Tap to open the walk-around video</Text>
                </Pressable>
              ) : (
                <VideoView
                  testID="walk-around-video"
                  style={styles.video}
                  player={player}
                  allowsFullscreen
                  nativeControls
                />
              )}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Return Vehicle</Text>
          {booking?.status === "return_requested" ? (
            <View style={[styles.returnCard, shadow.card]} testID="return-pending-card">
              <View style={styles.returnIconWrap}>
                <Ionicons name="hourglass" size={22} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.returnTitle}>Return request submitted</Text>
                <Text style={styles.returnBody}>The business will inspect your vehicle and confirm the deposit refund.</Text>
                {booking.customer_notes ? (
                  <Text style={styles.returnNote}>Your note: {booking.customer_notes}</Text>
                ) : null}
                <Pressable testID="cancel-return-button" onPress={cancelReturn} disabled={submitting} style={({ pressed }) => [styles.cancelReturnBtn, submitting && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
                  <Text style={styles.cancelReturnText}>{submitting ? "Cancelling…" : "Cancel Request"}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              testID="request-return-button"
              onPress={() => setShowModal(true)}
              style={({ pressed }) => [styles.returnCta, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.returnCtaText}>Request to Return Vehicle</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet} testID="request-return-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Return Vehicle</Text>
            <Text style={styles.sheetSub}>Let the business know you’d like to return {vehicle.model}. They will inspect and confirm your deposit refund.</Text>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              testID="return-request-notes"
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]}
              placeholder="Any details we should know — e.g. preferred handover time, fuel level, condition"
              placeholderTextColor={colors.onSurfaceSecondary}
              multiline
            />
            <Pressable
              testID="submit-return-request"
              onPress={requestReturn}
              disabled={submitting}
              style={({ pressed }) => [styles.submitBtn, submitting && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Submit Return Request</Text>}
            </Pressable>
            <Pressable onPress={() => setShowModal(false)} style={styles.modalCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  video: { width: "100%", height: 220, borderRadius: radius.lg, backgroundColor: "#000" },
  videoFallback: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, alignItems: "center", gap: spacing.sm },
  videoFallbackText: { color: colors.onSurface, fontWeight: "600" },
  returnCta: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, marginBottom: spacing.md },
  returnCtaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: type.base },
  returnCard: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.warning + "12", borderWidth: 1, borderColor: colors.warning + "44", marginBottom: spacing.md },
  returnIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warning + "22", alignItems: "center", justifyContent: "center" },
  returnTitle: { fontSize: type.lg, fontWeight: "800", color: colors.onSurface },
  returnBody: { color: colors.onSurfaceSecondary, marginTop: 4, fontSize: type.sm, lineHeight: 18 },
  returnNote: { color: colors.onSurface, fontSize: type.sm, marginTop: spacing.sm, fontStyle: "italic" },
  cancelReturnBtn: { marginTop: spacing.md, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.warning },
  cancelReturnText: { color: colors.warning, fontWeight: "700", fontSize: type.sm },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.onSurfaceSecondary, marginTop: 4, marginBottom: spacing.md, fontSize: type.base, lineHeight: 20 },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: type.base, color: colors.onSurface, backgroundColor: colors.surface },
  submitBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  modalCancel: { height: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  modalCancelText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
});
