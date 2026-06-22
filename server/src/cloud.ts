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
  display: string;
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
  const u = (await p.query(`SELECT display, email FROM users WHERE id=$1`, [userId])).rows[0];
  const d = (await p.query(`SELECT blob, version FROM user_data WHERE user_id=$1`, [userId])).rows[0];
  return { token, display: u.display, email: u.email, data: d?.blob ?? {}, version: d?.version ?? 0 };
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

// Save the user's data blob. Last-write-wins; returns the new version.
export async function putData(userId: number, data: unknown): Promise<number> {
  const now = Date.now();
  const r = await db().query(
    `UPDATE user_data SET blob=$2, version=version+1, updated_at=$3 WHERE user_id=$1 RETURNING version`,
    [userId, JSON.stringify(data ?? {}), now]
  );
  return r.rows[0]?.version ?? 0;
}

export async function logout(token: string): Promise<void> {
  if (token) await db().query(`DELETE FROM sessions WHERE token=$1`, [token]);
}

export async function deleteAccount(userId: number): Promise<void> {
  await db().query(`DELETE FROM users WHERE id=$1`, [userId]); // cascades to data/sessions
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
