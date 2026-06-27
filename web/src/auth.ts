// Lightweight, device-local accounts. Everything in this app already lives in
// the browser (binder, wishlist, settings), so accounts live here too: a
// username + a PBKDF2-hashed password kept in localStorage, and each account's
// data namespaced by username. This is not server-backed sign-in — passwords
// never leave the device — it just lets multiple people share a browser and
// keep separate collections, with a real log-in/log-out gate.

import { cloudEnabled, cloudRegister, cloudLogin, cloudLogout, cloudActive, cloudDeleteAccount, cloudGoogle, cloudRename } from "./cloud";

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
  "card-scanner-wanted",
];

interface StoredUser {
  display: string;
  salt: string; // hex ("" for Google accounts)
  hash: string; // hex ("" for Google accounts)
  createdAt: number;
  provider?: "local" | "google" | "cloud";
  email?: string;
}

// Mirror a server (cloud) account into the local users map so currentUser(),
// displayNameOf(), and emailOf() keep working unchanged. No password is stored
// locally for cloud accounts — the server holds it.
function upsertCloudUser(key: string, display: string, email: string | null) {
  const users = loadUsers();
  users[key] = {
    display,
    salt: "",
    hash: "",
    createdAt: users[key]?.createdAt || Date.now(),
    provider: "cloud",
    email: email || undefined,
  };
  saveUsers(users);
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

// Look up a local account by username for password reset. Returns its key,
// email, and whether it's a Google account (which has no password to reset).
export function accountForReset(username: string): { key: string; email?: string; isGoogle: boolean } | null {
  const key = keyOf(username);
  const u = loadUsers()[key];
  if (!u) return null;
  return { key, email: u.email, isGoogle: u.provider === "google" };
}

// Look up a local account by EMAIL for password reset.
export function accountByEmail(email: string): { key: string; email: string; display: string; isGoogle: boolean } | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const users = loadUsers();
  for (const key of Object.keys(users)) {
    const u = users[key];
    if (u.email && u.email.toLowerCase() === e) {
      return { key, email: u.email, display: u.display || key, isGoogle: u.provider === "google" };
    }
  }
  return null;
}

// Set a new password on an existing local account (used by the reset flow).
export async function resetPassword(key: string, newPassword: string): Promise<void> {
  const users = loadUsers();
  const u = users[key];
  if (!u) throw new Error("Account not found on this device.");
  if (u.provider === "google") throw new Error("This account uses Google sign-in — there's no password to reset.");
  if (newPassword.length < 4) throw new Error("Password needs at least 4 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  u.salt = toHex(salt);
  u.hash = await derive(newPassword, salt);
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, key); // log them in with the new password
}

// Hide most of an email for display: john@example.com -> j•••n@example.com
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local[0] || "" : local[0] + "•••" + local[local.length - 1];
  return `${shown}@${domain}`;
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
  // Cloud mode: the server owns the account so it works on any device.
  if (await cloudEnabled()) {
    const r = await cloudRegister(name.trim(), email.trim(), password);
    upsertCloudUser(r.key, r.display, r.email);
    localStorage.setItem(SESSION_KEY, r.key);
    return;
  }
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
  if (await cloudEnabled()) {
    const r = await cloudLogin(name.trim(), password);
    upsertCloudUser(r.key, r.display, r.email);
    localStorage.setItem(SESSION_KEY, r.key);
    return;
  }
  const key = keyOf(name);
  const user = loadUsers()[key];
  if (!user) throw new Error("No account with that username.");
  const hash = await derive(password, fromHex(user.salt));
  if (hash !== user.hash) throw new Error("Incorrect password.");
  migrateLegacy(key);
  localStorage.setItem(SESSION_KEY, key);
}

export function logout(): void {
  if (cloudActive()) void cloudLogout(); // end the server session too
  localStorage.removeItem(SESSION_KEY);
}

// Permanently remove an account and all of its data.
export function deleteAccount(key: string): void {
  if (cloudActive()) void cloudDeleteAccount(); // delete it on the server too
  const users = loadUsers();
  delete users[key];
  saveUsers(users);
  localStorage.removeItem(SESSION_KEY);
  for (const base of DATA_BASES) localStorage.removeItem(`${base}:${key}`);
  localStorage.removeItem(`card-scanner-last-auto-refresh:${key}`);
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

// A unique account key derived from a desired name (for new local accounts).
function uniqueKey(name: string, users: Users): string {
  const base = (keyOf(name).replace(/[^a-z0-9_]+/g, "") || "player").slice(0, 24);
  let key = base, n = 1;
  while (users[key]) { n += 1; key = `${base}${n}`; }
  return key;
}

// "Continue with Google" — signs in and AUTO-CREATES an account if none exists
// (no password). The username defaults to the part of the email before the @,
// and is editable later in Settings. Returns whether a new account was created
// so the caller can fire the welcome email / signup conversion.
export async function loginWithGoogle(credential: string): Promise<{ key: string; email: string; display: string; created: boolean }> {
  const claims = decodeJwt(credential);
  const email = claims.email ? String(claims.email) : "";
  if (!email) throw new Error("Google didn't share an email for this account.");
  const defaultName = (claims.name ? String(claims.name) : "").trim() || email.split("@")[0] || email;

  // Cloud mode: the server verifies the Google token and owns the account.
  if (await cloudEnabled()) {
    const before = loadUsers();
    const knew = Object.values(before).some((u) => u.email?.toLowerCase() === email.toLowerCase());
    const r = await cloudGoogle(credential);
    upsertCloudUser(r.key, r.display, r.email);
    localStorage.setItem(SESSION_KEY, r.key);
    return { key: r.key, email: r.email || email, display: r.display, created: !knew };
  }

  // Device-local mode: find the account by email, or create a fresh one.
  const users = loadUsers();
  const lower = email.toLowerCase();
  const existing = Object.keys(users).find((k) => users[k].email?.toLowerCase() === lower);
  if (existing) {
    migrateLegacy(existing);
    localStorage.setItem(SESSION_KEY, existing);
    return { key: existing, email, display: users[existing].display || existing, created: false };
  }
  const key = uniqueKey(email.split("@")[0] || defaultName, users);
  users[key] = { display: email.split("@")[0] || defaultName, salt: "", hash: "", createdAt: Date.now(), provider: "google", email };
  saveUsers(users);
  migrateLegacy(key);
  localStorage.setItem(SESSION_KEY, key);
  return { key, email, display: users[key].display, created: true };
}

// Rename the shown display name. The account key never changes, so data stays
// put. Updates the cloud server too when signed into a cloud account.
export async function setDisplayName(key: string, name: string): Promise<string> {
  const display = name.trim();
  if (display.length < 1) throw new Error("Username can't be empty.");
  if (display.length > 40) throw new Error("Username is too long (40 characters max).");
  if (display.includes(":")) throw new Error("Username can't contain a colon.");
  const users = loadUsers();
  if (!users[key]) throw new Error("Account not found on this device.");
  users[key].display = display;
  saveUsers(users);
  if (cloudActive()) await cloudRename(display);
  return display;
}
