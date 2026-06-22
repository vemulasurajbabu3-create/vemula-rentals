import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

export default function AdminMore() {
  const [tab, setTab] = useState<"docs" | "notify">("docs");
  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-more">
      <View style={styles.header}><Text style={styles.h1}>More</Text></View>
      <View style={styles.tabs}>
        <Pressable testID="tab-docs" onPress={() => setTab("docs")} style={[styles.tab, tab === "docs" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "docs" && styles.tabTextActive]}>Documents</Text>
        </Pressable>
        <Pressable testID="tab-notify" onPress={() => setTab("notify")} style={[styles.tab, tab === "notify" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "notify" && styles.tabTextActive]}>Announcements</Text>
        </Pressable>
      </View>
      {tab === "docs" ? <DocsList /> : <NotifyComposer />}
    </SafeAreaView>
  );
}

function DocsList() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    try { setDocs(await api("/admin/documents")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const review = async (id: string, status: "approved" | "rejected") => {
    await api(`/admin/documents/${id}/review`, { method: "POST", body: { status } });
    load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<Text style={styles.muted}>No documents submitted.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, shadow.card]} testID={`adoc-${item.id}`}>
            <Pressable onPress={() => setPreview(item)} style={{ flex: 1, flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={styles.docIcon}>
                <Ionicons name={item.mime_type?.includes("pdf") ? "document-text" : "image"} size={24} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.doc_type}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: item.status === "approved" ? colors.brandSecondary : item.status === "rejected" ? colors.error + "22" : colors.warning + "22" }]}>
                <Text style={[styles.chipText, { color: item.status === "approved" ? colors.onBrandSecondary : item.status === "rejected" ? colors.error : colors.warning }]}>{item.status}</Text>
              </View>
            </Pressable>
            {item.status === "pending" && (
              <View style={styles.reviewRow}>
                <Pressable testID={`approve-${item.id}`} onPress={() => review(item.id, "approved")} style={[styles.reviewBtn, { backgroundColor: colors.brandPrimary }]}>
                  <Text style={[styles.reviewBtnText, { color: colors.onBrandPrimary }]}>Approve</Text>
                </Pressable>
                <Pressable testID={`reject-${item.id}`} onPress={() => review(item.id, "rejected")} style={[styles.reviewBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
                  <Text style={[styles.reviewBtnText, { color: colors.error }]}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBg} onPress={() => setPreview(null)}>
          {preview?.mime_type?.includes("image") ? (
            <Image source={{ uri: preview.base64_data }} style={{ width: "92%", height: "70%" }} contentFit="contain" />
          ) : (
            <View style={styles.previewBox}>
              <Ionicons name="document-text" size={64} color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurface, marginTop: spacing.md, fontWeight: "700" }}>{preview?.name}</Text>
              <Text style={{ color: colors.onSurfaceSecondary, marginTop: 4 }}>PDF preview not available here</Text>
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

function NotifyComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  const sendBroadcast = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const n = await api<any>("/admin/notifications", { method: "POST", body: { title, body } });
      setTitle(""); setBody("");
      setRecent((prev) => [n, ...prev]);
    } catch {} finally { setSending(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={[styles.formCard, shadow.card]}>
          <Text style={styles.label}>Title</Text>
          <TextInput testID="notif-title" value={title} onChangeText={setTitle} placeholder="e.g. Rent price update" placeholderTextColor={colors.onSurfaceSecondary} style={styles.input} />
          <Text style={styles.label}>Message</Text>
          <TextInput testID="notif-body" value={body} onChangeText={setBody} placeholder="Write announcement..." placeholderTextColor={colors.onSurfaceSecondary} style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]} multiline />
          <Pressable testID="send-broadcast" onPress={sendBroadcast} disabled={sending || !title.trim() || !body.trim()} style={({ pressed }) => [styles.sendBtn, (!title.trim() || !body.trim() || sending) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
            {sending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Ionicons name="megaphone" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.sendText}>Send to All Users</Text>
              </>
            )}
          </Pressable>
        </View>
        {recent.map((n) => (
          <View key={n.id} style={[styles.card, shadow.card]}>
            <Text style={styles.name}>{n.title}</Text>
            <Text style={styles.meta}>{n.body}</Text>
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.onSurfaceSecondary, fontWeight: "700" },
  tabTextActive: { color: colors.brandPrimary },
  card: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  docIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  meta: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: type.sm },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  chipText: { fontSize: type.sm, fontWeight: "700", textTransform: "capitalize" },
  reviewRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  reviewBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: "center" },
  reviewBtnText: { fontWeight: "700" },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  formCard: { padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider },
  label: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: type.base, color: colors.onSurface, minHeight: 48 },
  sendBtn: { marginTop: spacing.lg, flexDirection: "row", gap: 6, backgroundColor: colors.brandPrimary, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  sendText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
  previewBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center" },
  previewBox: { backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.lg, alignItems: "center" },
});
