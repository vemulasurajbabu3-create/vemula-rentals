import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  auth?: boolean;
};

async function getToken(): Promise<string | null> {
  const t = await storage.secureGet<string>("token", "");
  return t || null;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  if (res.status === 204) return null as unknown as T;
  return res.json();
}

export async function setToken(token: string) {
  await storage.secureSet("token", token);
}

export async function clearAuth() {
  await storage.secureRemove("token");
  await storage.removeItem("is_admin");
}

export async function getStoredIsAdmin(): Promise<boolean> {
  const v = await storage.getItem<boolean>("is_admin", false);
  return !!v;
}

export async function setStoredIsAdmin(v: boolean) {
  await storage.setItem("is_admin", v);
}
