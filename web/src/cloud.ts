// Client side of cloud accounts + cross-device sync. Only active when the
// server reports cloud:true (DATABASE_URL set). It talks to /api/cloud/*,
// holds a bearer token, and syncs the per-user collection as one JSON blob:
// pull on login/open, debounced push on change.

const TOKEN_KEY = "card-scanner-cloud-token";
const TUSER_KEY = "card-scanner-cloud-user"; // lowercased username (namespacing key)
const VERSION_KEY = "card-scanner-cloud-version"; // last server version we've seen

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

const getVersion = () => Number(localStorage.getItem(VERSION_KEY) || "0");
const setVersion = (v: number) => localStorage.setItem(VERSION_KEY, String(v));

// Fired after a background pull or a merge-on-conflict changes localStorage, so
// the running app can re-read the freshly-synced collection.
const announceSync = () => window.dispatchEvent(new CustomEvent("cloud-synced"));

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

// --- conflict merge --------------------------------------------------------
// When two devices edit concurrently, neither side should win outright. We
// union collections by id and take the larger count for tallies, so nothing a
// device added is lost. Blobs are raw JSON strings keyed by base.
function parse<T>(s: unknown): T | undefined {
  if (typeof s !== "string") return undefined;
  try { return JSON.parse(s) as T; } catch { return undefined; }
}
function unionById<T extends { id?: unknown }>(local: T[] | undefined, server: T[] | undefined): T[] {
  const m = new Map<unknown, T>();
  // Server first, then local — so a card present on both keeps the local edit.
  for (const x of server || []) if (x && x.id != null) m.set(x.id, x);
  for (const x of local || []) if (x && x.id != null) m.set(x.id, x);
  return [...m.values()];
}
function mergeBlob(
  local: Record<string, string>,
  server: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const base of SYNC_BASES) {
    const l = local[base];
    const s = typeof server[base] === "string" ? (server[base] as string) : undefined;
    if (l == null && s == null) continue;
    if (base === "binder" || base === "wishlist" || base === "wanted") {
      out[base] = JSON.stringify(unionById(parse<{ id?: unknown }[]>(l), parse<{ id?: unknown }[]>(s)));
    } else if (base === "scans" || base === "trades") {
      out[base] = JSON.stringify(Math.max(parse<number>(l) ?? 0, parse<number>(s) ?? 0));
    } else if (base === "earned") {
      out[base] = JSON.stringify([...new Set([...(parse<string[]>(s) || []), ...(parse<string[]>(l) || [])])]);
    } else {
      // settings, theme: keep the local (most recent intent), else server.
      out[base] = l ?? (s as string);
    }
  }
  return out;
}

function store(auth: AuthResult): { key: string; display: string; email: string | null } {
  const key = auth.display.trim().toLowerCase();
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(TUSER_KEY, key);
  setVersion(auth.version || 0);
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
  localStorage.removeItem(VERSION_KEY);
}
export async function cloudDeleteAccount() {
  try {
    await fetch("/api/cloud/account", { method: "DELETE", headers: { Authorization: `Bearer ${cloudToken()}` } });
  } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TUSER_KEY);
  localStorage.removeItem(VERSION_KEY);
}
export async function cloudForgot(email: string) { await call("/api/cloud/forgot", { email }); }
export async function cloudReset(email: string, code: string, password: string) {
  await call("/api/cloud/reset", { email, code, password });
}

/**
 * Pull the latest server copy of this user's collection into localStorage.
 * Returns true if the server had a newer version than we last saw (so the UI
 * can refresh). No-op for non-cloud (device-local) accounts.
 */
export async function cloudPull(user: string): Promise<boolean> {
  if (!cloudActive()) return false;
  try {
    const res = await fetch("/api/cloud/sync", { headers: { Authorization: `Bearer ${cloudToken()}` } });
    if (!res.ok) return false;
    const { data, version } = (await res.json()) as { data?: Record<string, unknown>; version?: number };
    const v = Number(version || 0);
    if (v === getVersion()) return false; // nothing new
    applyBlob(user, data);
    setVersion(v);
    return true;
  } catch { return false; }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
async function pushNow(user: string, retry = true): Promise<void> {
  if (!cloudActive()) return;
  try {
    const res = await fetch("/api/cloud/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cloudToken()}` },
      body: JSON.stringify({ data: collectBlob(user), baseVersion: getVersion() }),
    });
    if (res.status === 409 && retry) {
      // Another device wrote since we synced. Merge their copy into ours instead
      // of overwriting it, then push the union once more.
      const { data, version } = (await res.json()) as { data?: Record<string, unknown>; version?: number };
      const merged = mergeBlob(collectBlob(user), data || {});
      applyBlob(user, merged);
      setVersion(Number(version || 0));
      announceSync(); // let the running app re-read the merged collection
      await pushNow(user, false);
      return;
    }
    if (res.ok) {
      const { version } = (await res.json()) as { version?: number };
      setVersion(Number(version || getVersion()));
    }
  } catch { /* offline — next change retries */ }
}
/** Debounced push of the user's collection to the server. */
export function schedulePush(user: string) {
  if (!cloudActive()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(user), 1500);
}
