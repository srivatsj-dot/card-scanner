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
  salt: string; // hex
  hash: string; // hex
  createdAt: number;
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

export async function register(name: string, password: string): Promise<void> {
  const display = name.trim();
  const key = keyOf(name);
  if (display.length < 2) throw new Error("Username needs at least 2 characters.");
  if (password.length < 4) throw new Error("Password needs at least 4 characters.");
  const users = loadUsers();
  if (users[key]) throw new Error("That username is already taken.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  users[key] = { display, salt: toHex(salt), hash, createdAt: Date.now() };
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
