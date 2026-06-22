import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type } from "@/src/theme";

export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSendOtp = async () => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api("/auth/request-otp", { method: "POST", body: { phone: clean }, auth: false });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.push({ pathname: "/auth/otp", params: { phone: clean } });
    } catch (e: any) {
      setError(e.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="login-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={styles.hero}>
          <View style={styles.logoCircle}>
            <Ionicons name="bicycle" size={36} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>RideLease</Text>
          <Text style={styles.tagline}>Your weekly ride, simplified.</Text>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>Sign in with your mobile number to continue</Text>

          <View style={styles.inputWrap}>
            <Text style={styles.countryCode}>+91</Text>
            <View style={styles.divider} />
            <TextInput
              testID="phone-input"
              style={styles.input}
              keyboardType="phone-pad"
              placeholder="98765 43210"
              placeholderTextColor={colors.onSurfaceSecondary}
              value={phone}
              maxLength={10}
              onChangeText={(t) => { setPhone(t.replace(/\D/g, "")); setError(""); }}
            />
          </View>

          {error ? <Text style={styles.errorText} testID="login-error">{error}</Text> : null}

          <Pressable
            testID="send-otp-button"
            onPress={onSendOtp}
            disabled={loading}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
          >
            {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Send OTP</Text>}
          </Pressable>

          <Text style={styles.hint}>Dev mode: any 6-digit OTP works. Use phone <Text style={{ fontWeight: "700" }}>9999999999</Text> for admin.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: { paddingTop: spacing.xxxl, paddingBottom: spacing.xxl, alignItems: "center", borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  brand: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  tagline: { fontSize: type.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  title: { fontSize: type.xxl, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: type.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs, marginBottom: spacing.xl },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 56 },
  countryCode: { fontSize: type.lg, fontWeight: "600", color: colors.onSurface, marginRight: spacing.md },
  divider: { width: 1, height: 24, backgroundColor: colors.border, marginRight: spacing.md },
  input: { flex: 1, fontSize: type.lg, color: colors.onSurface, paddingVertical: 0 },
  errorText: { color: colors.error, marginTop: spacing.sm, fontSize: type.base },
  cta: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  hint: { marginTop: spacing.lg, color: colors.onSurfaceSecondary, fontSize: type.sm, textAlign: "center" },
});
