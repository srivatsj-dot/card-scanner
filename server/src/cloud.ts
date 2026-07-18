// Cloud accounts + cross-device sync, backed by Postgres. Entirely optional:
// with no DATABASE_URL the whole module is dormant (hasCloud=false) and the app
// keeps using device-local accounts. When configured, the client stores its
// account and collection here so any device can log in and see the same data.
//
// Sync model: the client's per-user data (binder, wishlist, settings, trades,
// achievements, theme) is stored as one JSON blob with a version counter.
// Simple last-write-wins — fine for a single person across their own devices.

import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";
export const hasCloud = Boolean(DATABASE_URL);

let pool: pg.Pool | null = null;
function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      // External Render URLs need SSL; internal ones don't.
      ssl: /render\.com/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return pool;
}

export async function initCloud(): Promise<void> {
  if (!hasCloud) return;
  const p = db();
  await p.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display TEXT NOT NULL,
    email TEXT UNIQUE,
    provider TEXT NOT NULL DEFAULT 'local',
    salt TEXT,
    hash TEXT,
    created_at BIGINT NOT NULL
  )`);
  await p.query(`CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blob JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL
  )`);
  await p.query(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
  )`);
  await p.query(`CREATE TABLE IF NOT EXISTS reset_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires BIGINT NOT NULL
  )`);
  // Server-generated morning briefings, shared by all users and persisted so a
  // restart/redeploy doesn't lose the day's briefing.
  await p.query(`CREATE TABLE IF NOT EXISTS digests (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  // Shareable trade offers: sender creates one, the recipient opens the link
  // (no account needed) and responds. Stored as one blob per offer.
  await p.query(`CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
}

export async function saveOffer(id: string, data: unknown): Promise<void> {
  if (!hasCloud) return;
  await db().query(
    `INSERT INTO offers (id, data, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=$3`,
    [id, JSON.stringify(data ?? {}), Date.now()]
  );
}
export async function loadOffer(id: string): Promise<unknown | null> {
  if (!hasCloud) return null;
  const r = await db().query(`SELECT data FROM offers WHERE id=$1`, [id]);
  return r.rows[0]?.data ?? null;
}

export async function saveDigest(key: string, data: unknown): Promise<void> {
  if (!hasCloud) return;
  await db().query(
    `INSERT INTO digests (key, data, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET data=$2, updated_at=$3`,
    [key, JSON.stringify(data ?? {}), Date.now()]
  );
}
export async function loadDigest(key: string): Promise<unknown | null> {
  if (!hasCloud) return null;
  const r = await db().query(`SELECT data FROM digests WHERE key=$1`, [key]);
  return r.rows[0]?.data ?? null;
}

// --- helpers ---------------------------------------------------------------
const key = (name: string) => name.trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const newSalt = () => randomBytes(16).toString("hex");
const newToken = () => randomBytes(32).toString("hex");
const hashPw = (password: string, salt: string) =>
  pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
const sameHash = (a: string, b: string) => {
  const ba = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export interface AuthResult {
  token: string;
  username: string; // stable account key (never changes; used for namespacing)
  display: string; // shown name, editable
  email: string | null;
  data: unknown;
  version: number;
}

class CloudError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export { CloudError };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAuth(userId: number, token: string): Promise<AuthResult> {
  const p = db();
  const u = (await p.query(`SELECT username, display, email FROM users WHERE id=$1`, [userId])).rows[0];
  const d = (await p.query(`SELECT blob, version FROM user_data WHERE user_id=$1`, [userId])).rows[0];
  return { token, username: u.username, display: u.display, email: u.email, data: d?.blob ?? {}, version: d?.version ?? 0 };
}

// Find-or-create a user from a Google-verified email (the server has already
// validated the Google token). Existing email → just start a session (Google
// lets you in without a password). New email → create an account whose username
// defaults to the part before the @, made unique. provider='google', no password.
export async function googleAuth(email: string, name: string): Promise<AuthResult> {
  const p = db();
  const lowerEmail = email.trim().toLowerCase();
  const existing = (await p.query(`SELECT id FROM users WHERE LOWER(email)=$1`, [lowerEmail])).rows[0];
  let id: number;
  if (existing) {
    id = existing.id as number;
  } else {
    const display = (name || lowerEmail.split("@")[0] || "player").trim();
    const base = (key(display).replace(/[^a-z0-9_]+/g, "") || "player").slice(0, 24);
    let uname = base, n = 1;
    while ((await p.query(`SELECT 1 FROM users WHERE username=$1`, [uname])).rowCount) {
      n += 1; uname = `${base}${n}`;
    }
    const now = Date.now();
    id = (await p.query(
      `INSERT INTO users (username, display, email, provider, created_at)
       VALUES ($1,$2,$3,'google',$4) RETURNING id`,
      [uname, display, email.trim(), now]
    )).rows[0].id as number;
    await p.query(`INSERT INTO user_data (user_id, blob, version, updated_at) VALUES ($1,'{}'::jsonb,0,$2)`, [id, now]);
  }
  const token = newToken();
  await p.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, id, Date.now()]);
  return loadAuth(id, token);
}

// Change the shown display name (the username people see). The stable account
// key (users.username) never changes, so renaming never moves anyone's data.
export async function renameUser(userId: number, display: string): Promise<string> {
  const d = (display || "").trim();
  if (d.length < 1) throw new CloudError(400, "Username can't be empty.");
  if (d.length > 40) throw new CloudError(400, "Username is too long.");
  await db().query(`UPDATE users SET display=$2 WHERE id=$1`, [userId, d]);
  return d;
}

export async function register(username: string, email: string, password: string): Promise<AuthResult> {
  const display = (username || "").trim();
  if (display.length < 2) throw new CloudError(400, "Username needs at least 2 characters.");
  if (display.includes(":")) throw new CloudError(400, "Username can't contain a colon.");
  if (!isEmail(email)) throw new CloudError(400, "Enter a valid email address.");
  if ((password || "").length < 4) throw new CloudError(400, "Password needs at least 4 characters.");
  const p = db();
  const uname = key(display);
  const lowerEmail = email.trim().toLowerCase();
  if ((await p.query(`SELECT 1 FROM users WHERE username=$1`, [uname])).rowCount) {
    throw new CloudError(409, "That username is already taken.");
  }
  if ((await p.query(`SELECT 1 FROM users WHERE LOWER(email)=$1`, [lowerEmail])).rowCount) {
    throw new CloudError(409, "An account with that email already exists.");
  }
  const salt = newSalt();
  const hash = hashPw(password, salt);
  const now = Date.now();
  const id = (await p.query(
    `INSERT INTO users (username, display, email, provider, salt, hash, created_at)
     VALUES ($1,$2,$3,'local',$4,$5,$6) RETURNING id`,
    [uname, display, email.trim(), salt, hash, now]
  )).rows[0].id as number;
  await p.query(`INSERT INTO user_data (user_id, blob, version, updated_at) VALUES ($1,'{}'::jsonb,0,$2)`, [id, now]);
  const token = newToken();
  await p.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, id, now]);
  return loadAuth(id, token);
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const p = db();
  const u = (await p.query(`SELECT id, salt, hash, provider FROM users WHERE username=$1`, [key(username)])).rows[0];
  if (!u) throw new CloudError(401, "No account with that username.");
  if (u.provider !== "local" || !u.salt || !u.hash) throw new CloudError(401, "This account uses a different sign-in method.");
  if (!sameHash(hashPw(password, u.salt), u.hash)) throw new CloudError(401, "Incorrect password.");
  const token = newToken();
  await p.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, u.id, Date.now()]);
  return loadAuth(u.id, token);
}

export async function userForToken(token: string): Promise<number | null> {
  if (!token) return null;
  const r = await db().query(`SELECT user_id FROM sessions WHERE token=$1`, [token]);
  return r.rows[0]?.user_id ?? null;
}

export async function getData(userId: number): Promise<{ data: unknown; version: number }> {
  const r = await db().query(`SELECT blob, version FROM user_data WHERE user_id=$1`, [userId]);
  return { data: r.rows[0]?.blob ?? {}, version: r.rows[0]?.version ?? 0 };
}

// Save the user's data blob with optimistic concurrency. The client sends the
// version it last saw; if the server has moved on (another device wrote), we
// REFUSE the write and hand back the current data so the client can merge and
// retry. This is what stops a stale or empty device from blindly clobbering a
// good collection (the "my account got deleted" bug). When baseVersion is
// omitted, it falls back to last-write-wins.
export async function putData(
  userId: number,
  data: unknown,
  baseVersion?: number
): Promise<{ version: number; conflict: boolean; data?: unknown }> {
  const now = Date.now();
  if (baseVersion != null) {
    const cur = await getData(userId);
    if (Number(cur.version) !== Number(baseVersion)) {
      return { version: Number(cur.version), conflict: true, data: cur.data };
    }
  }
  const r = await db().query(
    `UPDATE user_data SET blob=$2, version=version+1, updated_at=$3 WHERE user_id=$1 RETURNING version`,
    [userId, JSON.stringify(data ?? {}), now]
  );
  return { version: r.rows[0]?.version ?? 0, conflict: false };
}

export async function logout(token: string): Promise<void> {
  if (token) await db().query(`DELETE FROM sessions WHERE token=$1`, [token]);
}

export async function deleteAccount(userId: number): Promise<void> {
  await db().query(`DELETE FROM users WHERE id=$1`, [userId]); // cascades to data/sessions
}

// Wipe EVERY account and all synced data — a clean slate for a fresh start.
// Guarded behind an admin token at the route layer. Returns how many users
// were removed. No-op (returns 0) when cloud isn't configured.
export async function wipeAllAccounts(): Promise<number> {
  if (!hasCloud) return 0;
  const p = db();
  const n = Number((await p.query(`SELECT COUNT(*) AS c FROM users`)).rows[0]?.c ?? 0);
  // TRUNCATE … CASCADE clears users + user_data + sessions in one shot and
  // resets the id sequence so the restart really starts from scratch.
  await p.query(`TRUNCATE users, user_data, sessions, reset_codes RESTART IDENTITY CASCADE`);
  return n;
}

// --- password reset (works cross-device since accounts live on the server) --
export async function createResetCode(email: string): Promise<{ code: string; display: string } | null> {
  const p = db();
  const u = (await p.query(`SELECT display, provider FROM users WHERE LOWER(email)=$1`, [email.trim().toLowerCase()])).rows[0];
  if (!u || u.provider !== "local") return null;
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  await p.query(
    `INSERT INTO reset_codes (email, code, expires) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET code=$2, expires=$3`,
    [email.trim().toLowerCase(), code, Date.now() + 15 * 60 * 1000]
  );
  return { code, display: u.display };
}

export async function applyReset(email: string, code: string, password: string): Promise<void> {
  if ((password || "").length < 4) throw new CloudError(400, "Password needs at least 4 characters.");
  const p = db();
  const lower = email.trim().toLowerCase();
  const row = (await p.query(`SELECT code, expires FROM reset_codes WHERE email=$1`, [lower])).rows[0];
  if (!row || row.code !== code.trim() || Date.now() > Number(row.expires)) {
    throw new CloudError(400, "That code is wrong or expired.");
  }
  const salt = newSalt();
  const hash = hashPw(password, salt);
  await p.query(`UPDATE users SET salt=$2, hash=$3 WHERE LOWER(email)=$1`, [lower, salt, hash]);
  await p.query(`DELETE FROM reset_codes WHERE email=$1`, [lower]);
}
