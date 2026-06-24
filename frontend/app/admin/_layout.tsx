import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.onSurfaceSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.divider, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarButtonTestID: "tab-admin-dashboard", tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} /> }} />
      <Tabs.Screen name="vehicles" options={{ title: "Vehicles", tabBarButtonTestID: "tab-admin-vehicles", tabBarIcon: ({ color, size }) => <Ionicons name="bicycle" size={size} color={color} /> }} />
      <Tabs.Screen name="bookings" options={{ title: "Bookings", tabBarButtonTestID: "tab-admin-bookings", tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} /> }} />
      <Tabs.Screen name="users" options={{ title: "Users", tabBarButtonTestID: "tab-admin-users", tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarButtonTestID: "tab-admin-payments", tabBarIcon: ({ color, size }) => <Ionicons name="cash" size={size} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarButtonTestID: "tab-admin-more", tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color} /> }} />
      <Tabs.Screen name="map" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
