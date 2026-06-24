import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/src/api/client";
import { colors, spacing, radius, type, shadow } from "@/src/theme";

type V = any;

export default function AdminVehicles() {
  const [items, setItems] = useState<V[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<V | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api("/vehicles")); } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id: string) => {
    await api(`/vehicles/${id}`, { method: "DELETE" });
    load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="admin-vehicles">
      <View style={styles.header}>
        <Text style={styles.h1}>Vehicles</Text>
        <Pressable testID="add-vehicle-button" onPress={() => setCreating(true)} style={styles.addBtn}>
          <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<Text style={styles.muted}>No vehicles yet. Tap Add.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, shadow.card]} testID={`vehicle-${item.id}`}>
            <View style={styles.cardTop}>
              {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, { backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }]}><Ionicons name="bicycle" size={28} color={colors.brandPrimary} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.model}>{item.model}</Text>
                <Text style={styles.plate}>{item.number_plate}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>₹{item.weekly_rent}/wk</Text>
                  <View style={[styles.chip, { backgroundColor: item.status === "rented" ? colors.warning + "22" : colors.brandSecondary }]}>
                    <Text style={[styles.chipText, { color: item.status === "rented" ? colors.warning : colors.onBrandSecondary }]}>{item.status}</Text>
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.cardActions}>
              <Pressable testID={`edit-${item.id}`} onPress={() => setEditing(item)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}>
                <Ionicons name="create-outline" size={16} color={colors.onSurface} />
                <Text style={styles.actionLabel}>Edit</Text>
              </Pressable>
              <Pressable testID={`del-${item.id}`} onPress={() => remove(item.id)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Text style={[styles.actionLabel, { color: colors.error }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <VehicleSheet
        visible={creating || !!editing}
        initial={editing}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }}
      />
    </SafeAreaView>
  );
}

function VehicleSheet({ visible, initial, onClose, onSaved }: { visible: boolean; initial: any; onClose: () => void; onSaved: () => void }) {
  const [vt, setVt] = useState(initial?.vehicle_type || "Electric Scooter");
  const [model, setModel] = useState(initial?.model || "");
  const [plate, setPlate] = useState(initial?.number_plate || "");
  const [rent, setRent] = useState(String(initial?.weekly_rent || ""));
  const [deposit, setDeposit] = useState(String(initial?.security_deposit ?? "2000"));
  const [imageUrl, setImageUrl] = useState(initial?.image_url || "");
  const [instructions, setInstructions] = useState((initial?.instructions || []).join("\n"));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        vehicle_type: vt, model, number_plate: plate, weekly_rent: Number(rent) || 0,
        security_deposit: Number(deposit) || 0,
        image_url: imageUrl || null,
        instructions: instructions.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      if (initial) {
        await api(`/vehicles/${initial.id}`, { method: "PUT", body });
      } else {
        await api("/vehicles", { method: "POST", body });
      }
      onSaved();
    } catch {} finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.sheetTitle}>{initial ? "Edit Vehicle" : "Add Vehicle"}</Text>
            <Field label="Type" value={vt} onChange={setVt} testID="field-type" />
            <Field label="Model" value={model} onChange={setModel} testID="field-model" />
            <Field label="Number Plate" value={plate} onChange={setPlate} testID="field-plate" />
            <Field label="Weekly Rent (₹)" value={rent} onChange={setRent} testID="field-rent" keyboardType="numeric" />
            <Field label="Security Deposit (₹)" value={deposit} onChange={setDeposit} testID="field-deposit" keyboardType="numeric" />
            <Field label="Image URL (optional)" value={imageUrl} onChange={setImageUrl} testID="field-image" />
            <Field label="Instructions (one per line)" value={instructions} onChange={setInstructions} testID="field-instructions" multiline />
            <Pressable testID="save-vehicle-button" onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{initial ? "Save Changes" : "Create Vehicle"}</Text>}
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, testID, keyboardType, multiline }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 100, textAlignVertical: "top" }]}
        placeholderTextColor={colors.onSurfaceSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: type.xxl, fontWeight: "800", color: colors.onSurface },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  addText: { color: colors.onBrandPrimary, fontWeight: "700" },
  muted: { color: colors.onSurfaceSecondary, textAlign: "center", padding: spacing.xl },
  card: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  thumb: { width: 80, height: 80, borderRadius: radius.md },
  model: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  plate: { color: colors.onSurfaceSecondary, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  meta: { color: colors.onSurface, fontWeight: "600" },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  chipText: { fontSize: type.sm, fontWeight: "700", textTransform: "capitalize" },
  cardActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: spacing.sm },
  actionLabel: { color: colors.onSurface, fontWeight: "600" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: type.xl, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.lg },
  fieldLabel: { fontSize: type.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 48, fontSize: type.base, color: colors.onSurface },
  saveBtn: { backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  saveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.lg },
  cancelBtn: { height: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
});
