// Client side of cloud accounts + cross-device sync. Only active when the
// server reports cloud:true (DATABASE_URL set). It talks to /api/cloud/*,
// holds a bearer token, and syncs the per-user collection as one JSON blob:
// pull on login/open, debounced push on change.

const TOKEN_KEY = "card-scanner-cloud-token";
const TUSER_KEY = "card-scanner-cloud-user"; // lowercased username (namespacing key)

// The per-user localStorage keys that make up an account's collection.
const SYNC_BASES = ["settings", "binder", "wishlist", "theme", "scans", "trades", "earned", "wanted"];
const lsKey = (base: string, user: string) => `card-scanner-${base}:${user}`;

let enabled: Promise<boolean> | null = null;
/** Whether the server has cloud sync configured (memoized). */
export function cloudEnabled(): Promise<boolean> {
  if (!enabled) {
    enabled = fetch("/api/health")
      .then((r) => r.json())
      .then((d) => !!d.cloud)
      .catch(() => false);
  }
  return enabled;
}

export const cloudActive = () => !!localStorage.getItem(TOKEN_KEY);
export const cloudToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const cloudUserKey = () => localStorage.getItem(TUSER_KEY) || "";

interface AuthResult { token: string; display: string; email: string | null; data: Record<string, unknown>; version: number; }

async function call<T>(path: string, body: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${cloudToken()}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

// --- blob helpers ----------------------------------------------------------
// Store raw JSON strings so values round-trip exactly through the server.
function collectBlob(user: string): Record<string, string> {
  const blob: Record<string, string> = {};
  for (const base of SYNC_BASES) {
    const v = localStorage.getItem(lsKey(base, user));
    if (v != null) blob[base] = v;
  }
  return blob;
}
function applyBlob(user: string, blob: Record<string, unknown> | undefined) {
  if (!blob) return;
  for (const base of SYNC_BASES) {
    const v = blob[base];
    if (typeof v === "string") localStorage.setItem(lsKey(base, user), v);
  }
}

function store(auth: AuthResult): { key: string; display: string; email: string | null } {
  const key = auth.display.trim().toLowerCase();
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(TUSER_KEY, key);
  applyBlob(key, auth.data);
  return { key, display: auth.display, email: auth.email };
}

export async function cloudRegister(username: string, email: string, password: string) {
  return store(await call<AuthResult>("/api/cloud/register", { username, email, password }));
}
export async function cloudLogin(username: string, password: string) {
  return store(await call<AuthResult>("/api/cloud/login", { username, password }));
}
export async function cloudLogout() {
  try { await call("/api/cloud/logout", {}, true); } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TUSER_KEY);
}
export async function cloudDeleteAccount() {
  try {
    await fetch("/api/cloud/account", { method: "DELETE", headers: { Authorization: `Bearer ${cloudToken()}` } });
  } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TUSER_KEY);
}
export async function cloudForgot(email: string) { await call("/api/cloud/forgot", { email }); }
export async function cloudReset(email: string, code: string, password: string) {
  await call("/api/cloud/reset", { email, code, password });
}

/** Pull the latest server copy of this user's collection into localStorage. */
export async function cloudPull(user: string): Promise<void> {
  if (!cloudActive()) return;
  const res = await fetch("/api/cloud/sync", { headers: { Authorization: `Bearer ${cloudToken()}` } });
  if (!res.ok) return;
  const { data } = (await res.json()) as { data?: Record<string, unknown> };
  applyBlob(user, data);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
async function pushNow(user: string) {
  if (!cloudActive()) return;
  try {
    await fetch("/api/cloud/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cloudToken()}` },
      body: JSON.stringify({ data: collectBlob(user) }),
    });
  } catch { /* offline — next change retries */ }
}
/** Debounced push of the user's collection to the server. */
export function schedulePush(user: string) {
  if (!cloudActive()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(user), 1500);
}
