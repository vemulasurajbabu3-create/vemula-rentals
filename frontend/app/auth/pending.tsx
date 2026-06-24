import { useCallback, useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api, clearAuth } from "@/src/api/client";
import BusinessContact from "@/src/components/BusinessContact";
import { colors, spacing, radius, type } from "@/src/theme";

export default function PendingApproval() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const me = await api<any>("/users/me");
      setStatus((me.status || "pending") as any);
      if (me.status === "approved") router.replace("/customer/home");
    } catch {} finally { setChecking(false); }
  }, [router]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => {
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const logout = async () => { await clearAuth(); router.replace("/auth/login"); };

  const isRejected = status === "rejected";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="pending-approval-screen">
      <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={styles.hero}>
        <View style={[styles.iconWrap, { backgroundColor: isRejected ? colors.error : colors.brandPrimary }]}>
          <Ionicons name={isRejected ? "close-circle" : "hourglass"} size={36} color={colors.onBrandPrimary} />
        </View>
        <Text style={styles.title}>{isRejected ? "Account Rejected" : "Awaiting Approval"}</Text>
        <Text style={styles.subtitle}>
          {isRejected
            ? "Your account has been rejected. Please contact Vemula Rentals to know more."
            : "Welcome to Vemula Rentals! Your account is being reviewed. We'll notify you once approved."}
        </Text>
      </LinearGradient>

      <View style={styles.body}>
        <BusinessContact note={isRejected ? "Hi, my account was rejected — can you help?" : "Hi, please approve my Vemula Rentals account."} />

        <Pressable
          testID="check-status-button"
          onPress={refresh}
          disabled={checking}
          style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.85 }, checking && { opacity: 0.6 }]}
        >
          {checking ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <Ionicons name="refresh" size={18} color={colors.brandPrimary} />
              <Text style={styles.refreshText}>Check status again</Text>
            </>
          )}
        </Pressable>

        <Pressable testID="logout-button" onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: { paddingTop: spacing.xxxl, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl, alignItems: "center", borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  iconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  title: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  subtitle: { fontSize: type.base, color: colors.onSurfaceSecondary, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },
  body: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  refreshBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary },
  refreshText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.base },
  logoutBtn: { padding: spacing.md, alignItems: "center" },
  logoutText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
});
