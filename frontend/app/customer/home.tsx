import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";
import { getStatus, requestPermissions, sendCurrentLocation, startBackgroundTracking, stopBackgroundTracking, isBackgroundRunning } from "@/src/services/location";

type Vehicle = any;
type Payment = any;
type Notif = any;
type Profile = any;

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [pending, setPending] = useState<Payment | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locStatus, setLocStatus] = useState({ granted: false, background: false, canAskAgain: true, lastAt: "" });
  const [locBusy, setLocBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, v, pm, n] = await Promise.all([
        api<Profile>("/users/me"),
        api<Vehicle | null>("/users/me/vehicle"),
        api<Payment[]>("/payments/me"),
        api<Notif[]>("/notifications/me"),
      ]);
      setProfile(p);
      setVehicle(v);
      setPending(pm.find((x: Payment) => x.status === "pending") || null);
      setNotifs(n.slice(0, 5));
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  const refreshLocStatus = useCallback(async () => {
    const s = await getStatus();
    const bgRunning = await isBackgroundRunning();
    setLocStatus({ granted: s.granted, background: s.background && bgRunning, canAskAgain: s.canAskAgain, lastAt: "" });
  }, []);

  useFocusEffect(useCallback(() => { load(); refreshLocStatus(); }, [load, refreshLocStatus]));

  useEffect(() => {
    // Send current location once on mount if permission already granted
    (async () => {
      const s = await getStatus();
      if (s.granted) {
        const r = await sendCurrentLocation();
        if (r) setLocStatus((prev) => ({ ...prev, lastAt: new Date().toISOString() }));
        if (s.background) {
          const ok = await startBackgroundTracking();
          setLocStatus((prev) => ({ ...prev, background: ok }));
        }
      }
    })();
  }, []);

  const onEnableLocation = async () => {
    setLocBusy(true);
    try {
      const s = await getStatus();
      if (!s.granted && !s.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      const r = await requestPermissions();
      if (r.granted) {
        await sendCurrentLocation();
        if (r.background) await startBackgroundTracking();
      }
      await refreshLocStatus();
    } finally { setLocBusy(false); }
  };

  const onDisableLocation = async () => {
    await stopBackgroundTracking();
    await refreshLocStatus();
  };

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const dueDate = pending?.due_date ? new Date(pending.due_date) : null;
  const daysLeft = dueDate ? Math.max(0, Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="home-screen">
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <View>
            <Text style={styles.hi}>Hello,</Text>
            <Text style={styles.name}>{profile?.full_name || "Rider"}</Text>
          </View>
          <Pressable onPress={() => router.push("/customer/profile")} testID="home-profile-button" style={styles.avatar}>
            <Ionicons name="person" color={colors.onBrandPrimary} size={22} />
          </Pressable>
        </View>

        {/* Location banner */}
        <View
          style={[
            styles.locBanner,
            { backgroundColor: locStatus.granted ? colors.brandTertiary : colors.warning + "18", borderColor: locStatus.granted ? colors.brandSecondary : colors.warning + "44" },
          ]}
          testID="location-banner"
        >
          <Ionicons name={locStatus.granted ? "location" : "location-outline"} size={20} color={locStatus.granted ? colors.brandPrimary : colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.locTitle, { color: locStatus.granted ? colors.brandPrimary : colors.warning }]}>
              {Platform.OS === "web"
                ? "Live location sharing"
                : locStatus.granted
                ? (locStatus.background ? "Live location sharing active" : "Location sharing active")
                : "Enable location sharing"}
            </Text>
            <Text style={styles.locBody}>
              {Platform.OS === "web"
                ? "Available in the mobile app. Share your live location for rental tracking."
                : locStatus.granted
                ? (locStatus.background ? "Sharing live updates with the rental business." : "Tap below to also enable background tracking.")
                : "Share your live location for rental tracking. Required by your rental agreement."}
            </Text>
          </View>
          {Platform.OS !== "web" && (
            locStatus.granted ? (
              locStatus.background ? (
                <Pressable testID="loc-stop-button" onPress={onDisableLocation} style={styles.locBtnGhost}><Text style={styles.locBtnGhostText}>Stop</Text></Pressable>
              ) : (
                <Pressable testID="loc-enable-bg-button" onPress={onEnableLocation} disabled={locBusy} style={styles.locBtn}>
                  {locBusy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.locBtnText}>Enable</Text>}
                </Pressable>
              )
            ) : (
              <Pressable testID="loc-enable-button" onPress={onEnableLocation} disabled={locBusy} style={styles.locBtn}>
                {locBusy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.locBtnText}>{locStatus.canAskAgain ? "Allow" : "Settings"}</Text>}
              </Pressable>
            )
          )}
        </View>

        {/* Payment Card */}
        <View style={[styles.paymentCard, shadow.card]} testID="payment-status-card">
          <View style={styles.paymentTop}>
            <View>
              <Text style={styles.paymentLabel}>Weekly Payment</Text>
              <Text style={styles.paymentAmount}>₹{pending ? Number(pending.amount).toFixed(0) : "0"}</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: pending ? colors.warning + "22" : colors.brandSecondary }]}>
              <Text style={[styles.statusChipText, { color: pending ? colors.warning : colors.onBrandSecondary }]}>
                {pending ? "Pending" : "All Paid"}
              </Text>
            </View>
          </View>
          {pending && (
            <Text style={styles.due}>Due in {daysLeft} {daysLeft === 1 ? "day" : "days"} · {dueDate?.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</Text>
          )}
          <Pressable
            testID="quick-pay-button"
            onPress={() => router.push("/customer/payments")}
            disabled={!pending}
            style={({ pressed }) => [styles.payCta, !pending && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="flash" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.payCtaText}>{pending ? "Quick Pay via UPI" : "No pending dues"}</Text>
          </Pressable>
        </View>

        {/* Vehicle Card */}
        <Text style={styles.sectionTitle}>Your Vehicle</Text>
        {vehicle ? (
          <Pressable onPress={() => router.push("/customer/vehicle")} style={[styles.vehicleCard, shadow.card]} testID="vehicle-card">
            {vehicle.image_url ? (
              <Image source={{ uri: vehicle.image_url }} style={styles.vehicleImg} contentFit="cover" />
            ) : (
              <View style={[styles.vehicleImg, { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="bicycle" size={48} color={colors.brandPrimary} />
              </View>
            )}
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleModel}>{vehicle.model}</Text>
              <Text style={styles.vehiclePlate}>{vehicle.number_plate}</Text>
              <View style={styles.vehicleMetaRow}>
                <View style={styles.statusDot} />
                <Text style={styles.vehicleMeta}>{vehicle.status} · ₹{vehicle.weekly_rent}/wk</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
        ) : (
          <View style={[styles.emptyCard, shadow.card]} testID="no-vehicle-card">
            <Ionicons name="bicycle-outline" size={32} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No vehicle assigned</Text>
            <Text style={styles.emptyBody}>Contact the rental business to get your vehicle assigned.</Text>
          </View>
        )}

        {/* Notifications */}
        <Text style={styles.sectionTitle}>Recent Updates</Text>
        {notifs.length === 0 ? (
          <View style={[styles.emptyCard, shadow.card]}>
            <Ionicons name="notifications-outline" size={28} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyBody}>No updates yet.</Text>
          </View>
        ) : (
          notifs.map((n) => (
            <View key={n.id} style={[styles.notifRow, shadow.card]} testID={`notif-${n.id}`}>
              <View style={styles.notifDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.notifTitle}>{n.title}</Text>
                <Text style={styles.notifBody}>{n.body}</Text>
              </View>
            </View>
          ))
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  hi: { fontSize: type.base, color: colors.onSurfaceSecondary },
  name: { fontSize: type.xxl, fontWeight: "700", color: colors.onSurface },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  locBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md },
  locTitle: { fontSize: type.base, fontWeight: "700" },
  locBody: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  locBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 72, alignItems: "center" },
  locBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.sm },
  locBtnGhost: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  locBtnGhostText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.sm },
  paymentCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider },
  paymentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  paymentLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  paymentAmount: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -1 },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusChipText: { fontSize: type.sm, fontWeight: "700" },
  due: { fontSize: type.base, color: colors.warning, marginTop: spacing.sm, fontWeight: "600" },
  payCta: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  payCtaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
  sectionTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  vehicleCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.divider, gap: spacing.md },
  vehicleImg: { width: 72, height: 72, borderRadius: radius.md },
  vehicleInfo: { flex: 1 },
  vehicleModel: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  vehiclePlate: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  vehicleMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  vehicleMeta: { fontSize: type.sm, color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider, alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptyBody: { fontSize: type.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  notifRow: { flexDirection: "row", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.divider, alignItems: "center" },
  notifDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  notifTitle: { fontWeight: "700", color: colors.onSurface, fontSize: type.base },
  notifBody: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
});
