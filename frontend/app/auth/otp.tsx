import { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api, setToken, setStoredIsAdmin } from "@/src/api/client";
import { colors, spacing, radius, type } from "@/src/theme";

export default function Otp() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  const onChange = (i: number, v: string) => {
    const c = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = c;
    setDigits(next);
    setError("");
    if (c && i < 5) inputs.current[i + 1]?.focus();
  };

  const onKey = (i: number, e: any) => {
    if (e.nativeEvent.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  };

  const onVerify = async () => {
    const otp = digits.join("");
    if (otp.length !== 6) { setError("Enter all 6 digits"); return; }
    setLoading(true);
    try {
      const res = await api<{ token: string; is_admin: boolean; user_id: string; is_new_user: boolean; status?: string }>(
        "/auth/verify-otp",
        { method: "POST", body: { phone, otp }, auth: false }
      );
      await setToken(res.token);
      await setStoredIsAdmin(res.is_admin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (res.is_admin) router.replace("/admin/dashboard");
      else if (res.status && res.status !== "approved") router.replace("/auth/pending");
      else router.replace("/customer/home");
    } catch (e: any) {
      setError(e.message || "Verification failed");
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container} testID="otp-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="otp-back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.body}>
          <Text style={styles.title}>Verify OTP</Text>
          <Text style={styles.subtitle}>We sent a 6-digit code to +91 {phone}</Text>

          <View style={styles.row}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                testID={`otp-digit-${i}`}
                ref={(r) => { inputs.current[i] = r; }}
                style={[styles.cell, d ? styles.cellFilled : null]}
                keyboardType="number-pad"
                maxLength={1}
                value={d}
                onChangeText={(v) => onChange(i, v)}
                onKeyPress={(e) => onKey(i, e)}
              />
            ))}
          </View>

          {error ? <Text style={styles.errorText} testID="otp-error">{error}</Text> : null}

          <Pressable
            testID="verify-otp-button"
            onPress={onVerify}
            disabled={loading}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
          >
            {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Verify & Continue</Text>}
          </Pressable>

          <Text style={styles.hint}>Tip: enter any 6 digits in dev mode (e.g. 123456).</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  back: { padding: spacing.lg },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  title: { fontSize: type.xxl, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: type.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs, marginBottom: spacing.xxl },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  cell: { flex: 1, height: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, fontSize: type.xxl, fontWeight: "700", textAlign: "center", color: colors.onSurface, backgroundColor: colors.surface },
  cellFilled: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  errorText: { color: colors.error, marginTop: spacing.lg, fontSize: type.base },
  cta: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  hint: { marginTop: spacing.lg, color: colors.onSurfaceSecondary, fontSize: type.sm, textAlign: "center" },
});
