import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type Doc = any;

const DOC_TYPES = [
  { key: "license", label: "Driving License", icon: "card-outline" },
  { key: "id_proof", label: "ID Proof", icon: "person-outline" },
  { key: "agreement", label: "Rental Agreement", icon: "document-text-outline" },
  { key: "other", label: "Other", icon: "folder-outline" },
];

export default function DocumentsScreen() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    try { setDocs(await api<Doc[]>("/documents/me")); } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const uploadFor = async (docType: string) => {
    setPickerOpen(false);
    setUploading(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setUploading(false); return; }
      // Prefer image picker for photos, fallback to document picker
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        quality: 0.6,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) { setUploading(false); return; }
      const a = res.assets[0];
      const b64 = a.base64 ? `data:${a.mimeType || "image/jpeg"};base64,${a.base64}` : "";
      if (!b64) { setUploading(false); return; }
      await api("/documents", { method: "POST", body: { doc_type: docType, name: a.fileName || `${docType}-${Date.now()}.jpg`, base64_data: b64, mime_type: a.mimeType || "image/jpeg" } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await load();
    } catch {} finally { setUploading(false); }
  };

  const uploadPdf = async () => {
    setPickerOpen(false);
    setUploading(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) { setUploading(false); return; }
      const a = res.assets[0];
      // Fetch and convert to base64
      const r = await fetch(a.uri);
      const blob = await r.blob();
      const b64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await api("/documents", { method: "POST", body: { doc_type: "agreement", name: a.name, base64_data: b64, mime_type: a.mimeType || "application/pdf" } });
      await load();
    } catch {} finally { setUploading(false); }
  };

  const remove = async (id: string) => {
    await api(`/documents/${id}`, { method: "DELETE" });
    await load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="documents-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Documents</Text>
        <Text style={styles.sub}>Upload your KYC and rental papers</Text>
      </View>

      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.emptyBox} testID="docs-empty">
            <Ionicons name="cloud-upload-outline" size={42} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No documents yet</Text>
            <Text style={styles.emptyBody}>Tap Upload below to share your documents securely.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.docCard, shadow.card]} testID={`doc-${item.id}`}>
            <View style={styles.docIcon}>
              <Ionicons name={item.mime_type?.includes("pdf") ? "document-text" : "image"} size={24} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.docMeta}>{DOC_TYPES.find((t) => t.key === item.doc_type)?.label || item.doc_type}</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: item.status === "approved" ? colors.brandSecondary : item.status === "rejected" ? colors.error + "22" : colors.warning + "22" }]}>
              <Text style={[styles.statusText, { color: item.status === "approved" ? colors.onBrandSecondary : item.status === "rejected" ? colors.error : colors.warning }]}>
                {item.status}
              </Text>
            </View>
            <Pressable onPress={() => remove(item.id)} testID={`delete-doc-${item.id}`} style={{ paddingLeft: spacing.sm }}>
              <Ionicons name="trash-outline" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        )}
      />

      <Pressable
        testID="upload-document-button"
        onPress={() => setPickerOpen(true)}
        disabled={uploading}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }, uploading && { opacity: 0.6 }]}
      >
        {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
          <>
            <Ionicons name="cloud-upload" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.fabText}>Upload Document</Text>
          </>
        )}
      </Pressable>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Choose document type</Text>
            {DOC_TYPES.map((t) => (
              <Pressable key={t.key} testID={`pick-${t.key}`} onPress={() => uploadFor(t.key)} style={({ pressed }) => [styles.typeRow, pressed && { backgroundColor: colors.surfaceSecondary }]}>
                <View style={styles.docIcon}><Ionicons name={t.icon as any} size={22} color={colors.brandPrimary} /></View>
                <Text style={styles.typeLabel}>{t.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            ))}
            {Platform.OS !== "web" && (
              <Pressable testID="pick-pdf" onPress={uploadPdf} style={({ pressed }) => [styles.typeRow, pressed && { backgroundColor: colors.surfaceSecondary }]}>
                <View style={styles.docIcon}><Ionicons name="document-attach-outline" size={22} color={colors.brandPrimary} /></View>
                <Text style={styles.typeLabel}>Upload PDF (Agreement)</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  sub: { color: colors.onSurfaceSecondary, marginTop: 2 },
  emptyBox: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.lg, marginTop: spacing.lg },
  emptyTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptyBody: { color: colors.onSurfaceSecondary, textAlign: "center" },
  docCard: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, gap: spacing.md },
  docIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  docName: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  docMeta: { color: colors.onSurfaceSecondary, fontSize: type.sm, marginTop: 2 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: type.sm, fontWeight: "700", textTransform: "capitalize" },
  fab: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  fabText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: spacing.xs },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  typeRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, gap: spacing.md },
  typeLabel: { flex: 1, color: colors.onSurface, fontWeight: "600", fontSize: type.base },
});
