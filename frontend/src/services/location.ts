/**
 * RideLease location service - foreground request + background tracking task.
 * Background tracking only works in a development/production build (not Expo Go).
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

const BG_TASK = "ridelease-bg-location";
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type LocationStatus = {
  granted: boolean;
  background: boolean;
  canAskAgain: boolean;
  lastLat?: number;
  lastLng?: number;
  lastAt?: string;
};

// Register the background task ONCE at module load (must be top-level)
if (!TaskManager.isTaskDefined(BG_TASK)) {
  TaskManager.defineTask(BG_TASK, async ({ data, error }: any) => {
    if (error) return;
    const locations = data?.locations || [];
    const token = await storage.secureGet<string>("token", "");
    if (!token || locations.length === 0) return;
    const last = locations[locations.length - 1];
    try {
      await fetch(`${BASE}/api/users/me/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ latitude: last.coords.latitude, longitude: last.coords.longitude }),
      });
    } catch {}
  });
}

export async function getStatus(): Promise<LocationStatus> {
  if (Platform.OS === "web") return { granted: false, background: false, canAskAgain: true };
  const fg = await Location.getForegroundPermissionsAsync();
  let bg = { status: "undetermined" as Location.PermissionStatus, canAskAgain: true };
  try { bg = await Location.getBackgroundPermissionsAsync() as any; } catch {}
  return {
    granted: fg.status === "granted",
    background: bg.status === "granted",
    canAskAgain: fg.canAskAgain,
  };
}

export async function requestPermissions(): Promise<LocationStatus> {
  if (Platform.OS === "web") return { granted: false, background: false, canAskAgain: false };
  const fg = await Location.requestForegroundPermissionsAsync();
  let bgGranted = false;
  if (fg.status === "granted") {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      bgGranted = bg.status === "granted";
    } catch {}
  }
  return { granted: fg.status === "granted", background: bgGranted, canAskAgain: fg.canAskAgain };
}

export async function sendCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === "web") return null;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return null;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const token = await storage.secureGet<string>("token", "");
    if (token) {
      await fetch(`${BASE}/api/users/me/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }),
      });
    }
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch { return null; }
}

export async function startBackgroundTracking(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") return false;
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BG_TASK).catch(() => false);
    if (isRunning) return true;
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5 * 60 * 1000, // 5 minutes
      distanceInterval: 200, // or every 200m
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "RideLease is sharing your location",
        notificationBody: "Your live location is shared with the rental business.",
      },
    });
    return true;
  } catch { return false; }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BG_TASK).catch(() => false);
    if (isRunning) await Location.stopLocationUpdatesAsync(BG_TASK);
  } catch {}
}

export async function isBackgroundRunning(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try { return await Location.hasStartedLocationUpdatesAsync(BG_TASK); } catch { return false; }
}
