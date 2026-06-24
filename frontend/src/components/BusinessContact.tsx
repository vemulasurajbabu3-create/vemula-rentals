/** Vemula Rentals business contact (calls & WhatsApp). */
import { Pressable, View, Text, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, type } from "@/src/theme";

export const BUSINESS_PHONE = "9160442323";
export const BUSINESS_NAME = "Vemula Rentals";

export function callBusiness() {
  Linking.openURL(`tel:+91${BUSINESS_PHONE}`).catch(() => {});
}

export function smsBusiness(message?: string) {
  const body = message ? `?body=${encodeURIComponent(message)}` : "";
  Linking.openURL(`sms:+91${BUSINESS_PHONE}${body}`).catch(() => {});
}

export function whatsappBusiness(message?: string) {
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  Linking.openURL(`https://wa.me/91${BUSINESS_PHONE}${text}`).catch(() => smsBusiness(message));
}

type Variant = "full" | "compact" | "row";

export default function BusinessContact({ variant = "full", note }: { variant?: Variant; note?: string }) {
  if (variant === "row") {
    return (
      <View style={styles.row} testID="business-contact-row">
        <Pressable testID="business-call" onPress={callBusiness} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="call" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.iconBtnText}>Call</Text>
        </Pressable>
        <Pressable testID="business-whatsapp" onPress={() => whatsappBusiness(note)} style={({ pressed }) => [styles.iconBtnGhost, pressed && { opacity: 0.85 }]}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.brandPrimary} />
          <Text style={styles.iconBtnGhostText}>WhatsApp</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.card, variant === "compact" && { padding: spacing.md }]} testID="business-contact-card">
      <View style={styles.heading}>
        <Ionicons name="storefront" size={18} color={colors.brandPrimary} />
        <Text style={styles.title}>Need help?</Text>
      </View>
      <Text style={styles.body}>Contact <Text style={{ fontWeight: "700" }}>{BUSINESS_NAME}</Text> at <Text style={{ fontWeight: "700" }}>+91 {BUSINESS_PHONE}</Text></Text>
      <View style={styles.row}>
        <Pressable testID="business-call" onPress={callBusiness} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="call" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.iconBtnText}>Call</Text>
        </Pressable>
        <Pressable testID="business-whatsapp" onPress={() => whatsappBusiness(note)} style={({ pressed }) => [styles.iconBtnGhost, pressed && { opacity: 0.85 }]}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.brandPrimary} />
          <Text style={styles.iconBtnGhostText}>WhatsApp</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandSecondary, gap: spacing.sm },
  heading: { flexDirection: "row", gap: 6, alignItems: "center" },
  title: { fontSize: type.lg, fontWeight: "700", color: colors.brandPrimary },
  body: { color: colors.onSurface, fontSize: type.base, marginBottom: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  iconBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, paddingVertical: spacing.sm, borderRadius: radius.md },
  iconBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
  iconBtnGhost: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary },
  iconBtnGhostText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.base },
});
