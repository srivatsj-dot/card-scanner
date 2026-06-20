// Lightweight, device-local accounts. Everything in this app already lives in
// the browser (binder, wishlist, settings), so accounts live here too: a
// username + a PBKDF2-hashed password kept in localStorage, and each account's
// data namespaced by username. This is not server-backed sign-in — passwords
// never leave the device — it just lets multiple people share a browser and
// keep separate collections, with a real log-in/log-out gate.

const USERS_KEY = "card-scanner-users";
const SESSION_KEY = "card-scanner-session";

// Per-user data lives under these bases, suffixed with `:username`.
const DATA_BASES = [
  "card-scanner-settings",
  "card-scanner-binder",
  "card-scanner-wishlist",
  "card-scanner-theme",
  "card-scanner-scans",
  "card-scanner-trades",
  "card-scanner-earned",
];

interface StoredUser {
  display: string;
  salt: string; // hex ("" for Google accounts)
  hash: string; // hex ("" for Google accounts)
  createdAt: number;
  provider?: "local" | "google";
  email?: string;
}
type Users = Record<string, StoredUser>;

function loadUsers(): Users {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}") as Users;
  } catch {
    return {};
  }
}
function saveUsers(u: Users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(u));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: BufferSource): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("This browser can't hash passwords securely (needs https or localhost).");
  }
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

const keyOf = (name: string) => name.trim().toLowerCase();

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export function emailOf(key: string): string | undefined {
  return loadUsers()[key]?.email;
}

export function currentUser(): string | null {
  const key = localStorage.getItem(SESSION_KEY);
  if (!key) return null;
  return loadUsers()[key] ? key : null;
}

export function displayNameOf(key: string): string {
  return loadUsers()[key]?.display || key;
}

export function hasAnyAccount(): boolean {
  return Object.keys(loadUsers()).length > 0;
}

// One-time adoption of pre-accounts data: the first account to sign in inherits
// the existing (un-namespaced) binder/wishlist/settings, then the legacy copies
// are cleared so later accounts start fresh.
function migrateLegacy(userKey: string) {
  const hasLegacy = DATA_BASES.some((b) => localStorage.getItem(b) != null);
  if (!hasLegacy) return;
  for (const base of DATA_BASES) {
    const legacy = localStorage.getItem(base);
    const nsKey = `${base}:${userKey}`;
    if (legacy != null && localStorage.getItem(nsKey) == null) {
      localStorage.setItem(nsKey, legacy);
    }
    localStorage.removeItem(base);
  }
}

export async function register(name: string, password: string, email: string): Promise<void> {
  const display = name.trim();
  const key = keyOf(name);
  if (display.length < 2) throw new Error("Username needs at least 2 characters.");
  if (display.includes(":")) throw new Error("Username can't contain a colon.");
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
  if (password.length < 4) throw new Error("Password needs at least 4 characters.");
  const users = loadUsers();
  if (users[key]) throw new Error("That username is already taken.");
  const lowerEmail = email.trim().toLowerCase();
  if (Object.values(users).some((u) => u.email?.toLowerCase() === lowerEmail)) {
    throw new Error("An account with that email already exists.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  users[key] = { display, salt: toHex(salt), hash, createdAt: Date.now(), provider: "local", email: email.trim() };
  saveUsers(users);
  migrateLegacy(key);
  localStorage.setItem(SESSION_KEY, key);
}

export async function login(name: string, password: string): Promise<void> {
  const key = keyOf(name);
  const user = loadUsers()[key];
  if (!user) throw new Error("No account with that username.");
  const hash = await derive(password, fromHex(user.salt));
  if (hash !== user.hash) throw new Error("Incorrect password.");
  migrateLegacy(key);
  localStorage.setItem(SESSION_KEY, key);
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

// --- Google sign-in --------------------------------------------------------
// The browser receives a signed Google ID token (JWT). We read the profile from
// it to key a local account by the Google user id (`sub`), which is globally
// unique — so there's never a username clash. Data still lives on this device;
// Google just provides identity and a display name (no password to remember).

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] || "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(b64)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return JSON.parse(json) as Record<string, unknown>;
}

export function loginWithGoogle(credential: string): { key: string; email?: string; isNew: boolean } {
  const claims = decodeJwt(credential);
  const sub = String(claims.sub || "");
  if (!sub) throw new Error("Google sign-in didn't return a valid account.");
  const email = claims.email ? String(claims.email) : undefined;
  const users = loadUsers();

  // If you already have an account using this email (e.g. you signed up with a
  // username + password and that email), Google signs you straight into it.
  if (email) {
    const lower = email.toLowerCase();
    const existing = Object.keys(users).find((k) => users[k].email?.toLowerCase() === lower);
    if (existing) {
      migrateLegacy(existing);
      localStorage.setItem(SESSION_KEY, existing);
      return { key: existing, email, isNew: false };
    }
  }

  // Otherwise use (or create) a Google-keyed account.
  const key = `google:${sub}`;
  const isNew = !users[key];
  if (isNew) {
    users[key] = {
      display: String(claims.name || email || "Google user"),
      salt: "",
      hash: "",
      createdAt: Date.now(),
      provider: "google",
      email,
    };
    saveUsers(users);
  }
  migrateLegacy(key);
  localStorage.setItem(SESSION_KEY, key);
  return { key, email, isNew };
}
