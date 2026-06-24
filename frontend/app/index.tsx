import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { storage } from "@/src/utils/storage";
import { colors } from "@/src/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>("token", "");
      const isAdmin = await storage.getItem<boolean>("is_admin", false);
      if (token) {
        if (isAdmin) { router.replace("/admin/dashboard"); return; }
        // Verify approval status before going to customer home
        try {
          const me = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ""}/api/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json());
          if (me && me.status && me.status !== "approved") router.replace("/auth/pending");
          else router.replace("/customer/home");
        } catch {
          router.replace("/customer/home");
        }
      } else {
        router.replace("/auth/login");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
