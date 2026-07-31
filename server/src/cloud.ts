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
  // Sessions expire: keep a last-used stamp so idle tokens can be swept.
  await p.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used BIGINT`).catch(() => {});
  // The email UNIQUE constraint is case-SENSITIVE, so "A@x.com" and "a@x.com"
  // could both register — that's how one person ended up with two accounts on the
  // same email. Enforce uniqueness on the lowercased email instead. (Best-effort:
  // fails if a DB already contains case-duplicate emails, which we then log.)
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))`)
    .catch((e) => console.warn("[cloud] couldn't add case-insensitive email index:", (e as Error).message));
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
  // Friend graph: one row per directed edge. status 'pending' (a requested b) or
  // 'accepted' (mutual — both directions get an accepted row).
  await p.query(`CREATE TABLE IF NOT EXISTS friend_edges (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  )`);
  // Direct messages between two accounts (marketplace chat).
  await p.query(`CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await p.query(`CREATE INDEX IF NOT EXISTS messages_pair ON messages (from_id, to_id, id)`);
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

// --- Trade marketplace: look up another collector by username, view their
// binder, and send a directed offer. Accepting auto-swaps the cards between the
// two accounts' binders. All accounts are searchable (per product decision).

interface MarketUser { id: number; username: string; display: string; email: string | null }
// A card as stored in a binder blob (we only touch id + carry the rest through).
interface BinderCard { id?: unknown; result?: { player?: string; year?: string; manufacturer?: string; setName?: string; sport?: string; estimatedValue?: { mid?: number; currency?: string } }; thumbnail?: string; [k: string]: unknown }

export async function findUserByName(name: string): Promise<MarketUser | null> {
  const key = (name || "").trim().toLowerCase();
  if (!key) return null;
  // Match the stable username OR the shown display name (case-insensitive).
  const r = await db().query(
    `SELECT id, username, display, email FROM users WHERE username=$1 OR LOWER(display)=$1 LIMIT 1`,
    [key]
  );
  const u = r.rows[0];
  return u ? { id: u.id, username: u.username, display: u.display, email: u.email } : null;
}

// The binder lives in the user's data blob as a JSON *string* under "binder".
async function binderOf(userId: number): Promise<BinderCard[]> {
  const r = await db().query(`SELECT blob FROM user_data WHERE user_id=$1`, [userId]);
  const raw = r.rows[0]?.blob?.binder;
  if (typeof raw !== "string") return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Read a boolean setting out of the blob (settings is also a JSON string).
async function settingOf(userId: number, key: string): Promise<unknown> {
  const r = await db().query(`SELECT blob FROM user_data WHERE user_id=$1`, [userId]);
  const raw = r.rows[0]?.blob?.settings;
  if (typeof raw !== "string") return undefined;
  try { return JSON.parse(raw)?.[key]; } catch { return undefined; }
}

// Overwrite the binder inside the blob and bump the version (server-authoritative
// — the swap is a server action, so we don't do optimistic concurrency here).
async function setBinder(userId: number, cards: BinderCard[]): Promise<void> {
  await db().query(
    `UPDATE user_data
       SET blob = jsonb_set(COALESCE(blob,'{}'::jsonb), '{binder}', to_jsonb($2::text)),
           version = version + 1, updated_at = $3
     WHERE user_id = $1`,
    [userId, JSON.stringify(cards), Date.now()]
  );
}

const cardLabel = (c: BinderCard): string => {
  const r = c.result || {};
  return [r.year, r.manufacturer, r.setName, r.player].map((x) => (x || "").toString().trim()).filter(Boolean).join(" ") || "Card";
};

export interface MarketCard { id: string; label: string; sport: string; value: number; currency: string; thumb: string; favorite: boolean; detail: unknown }
export function toMarketCard(c: BinderCard): MarketCard {
  const r = c.result || {};
  return {
    id: String(c.id ?? ""),
    label: cardLabel(c),
    sport: (r.sport || "").toString(),
    value: Number(r.estimatedValue?.mid) || 0,
    currency: (r.estimatedValue?.currency || "USD").toString(),
    thumb: typeof c.thumbnail === "string" ? c.thumbnail : "",
    favorite: (c as { favorite?: boolean }).favorite === true,
    // The full scan result, so a trade partner can view ALL of a card's info.
    detail: c.result || null,
  };
}

// A user's wishlist labels (for green "they want this" outlines in trades).
async function wishlistOf(userId: number): Promise<string[]> {
  const r = await db().query(`SELECT blob FROM user_data WHERE user_id=$1`, [userId]);
  const raw = r.rows[0]?.blob?.wishlist;
  if (typeof raw !== "string") return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a.map((w: { text?: string; result?: { player?: string; setName?: string; year?: string } }) =>
      (w?.result ? [w.result.year, w.result.setName, w.result.player].filter(Boolean).join(" ") : w?.text || "")
    ).map((s: string) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** Public binder view for the marketplace: look someone up by username/display,
 * plus their wishlist and avatar so the client can show wants/favorites. */
export async function lookupBinder(username: string, viewerId?: number): Promise<{ username: string; display: string; cards: MarketCard[]; wishlist: string[]; avatar: string } | null> {
  if (!hasCloud) return null;
  const u = await findUserByName(username);
  if (!u) return null;
  // Privacy: by default a binder is visible only to friends (and yourself).
  if (viewerId && viewerId !== u.id) {
    const vis = (await settingOf(u.id, "binderPrivacy")) || "friends";
    if (vis !== "anyone" && !(await areFriends(viewerId, u.id))) {
      throw new CloudError(403, `${u.display} only shares their binder with friends. Send them a friend request first.`);
    }
  }
  const cards = (await binderOf(u.id)).filter((c) => c.id != null).map(toMarketCard);
  const wishlist = await wishlistOf(u.id);
  const avatar = String((await settingOf(u.id, "avatar")) || "");
  return { username: u.username, display: u.display, cards, wishlist, avatar };
}

/** Card search, scoped to the searcher's friends: "which of my friends has a
 * card matching this text?" Returns each matching friend with only the cards
 * that matched, so the client can jump straight into a trade with them. */
export async function searchFriendCards(
  userId: number,
  query: string
): Promise<{ username: string; display: string; avatar: string; cards: MarketCard[] }[]> {
  if (!hasCloud) return [];
  const tokens = (query || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1);
  if (!tokens.length) return [];
  const friendIds = (await db().query(
    `SELECT friend_id FROM friend_edges WHERE user_id=$1 AND status='accepted'`,
    [userId]
  )).rows.map((r) => r.friend_id as number);
  if (!friendIds.length) return [];
  const info = await usersByIds(friendIds);
  const out: { username: string; display: string; avatar: string; cards: MarketCard[] }[] = [];
  for (const fid of friendIds) {
    const who = info[fid];
    if (!who) continue;
    const cards = (await binderOf(fid)).filter((c) => c.id != null).map(toMarketCard);
    // A card matches when every search token appears somewhere in its label.
    const matches = cards.filter((c) => {
      const lbl = c.label.toLowerCase();
      return tokens.every((tok) => lbl.includes(tok));
    });
    if (matches.length) {
      const avatar = String((await settingOf(fid, "avatar")) || "");
      out.push({ username: who.username, display: who.display, avatar, cards: matches });
    }
  }
  return out;
}

export interface MarketOffer {
  id: string;
  fromUser: string; fromDisplay: string;
  toUser: string; toDisplay: string;
  give: BinderCard[]; // cards the sender gives (full snapshots, to move on accept)
  want: BinderCard[]; // cards the sender wants from the recipient
  status: "pending" | "accepted" | "declined" | "cancelled" | "countered";
  createdAt: number; respondedAt: number | null;
  counter?: boolean; // this offer is a counter to a previous one
}

const reid = (c: BinderCard, now: number): BinderCard => ({
  ...c,
  id: `${now.toString(36)}-${Math.abs(hash(JSON.stringify(c.id) + now)).toString(36)}`,
  savedAt: now,
});
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** Create a directed offer from `fromUserId` to the named recipient. */
export async function createMarketOffer(
  fromUserId: number,
  toUsername: string,
  give: BinderCard[],
  want: BinderCard[],
  counterOf?: string // id of an offer this one counters (I received it, I'm replying)
): Promise<{ id: string; toDisplay: string; toEmail: string | null; notify: boolean; counter: boolean }> {
  const from = (await db().query(`SELECT id, username, display FROM users WHERE id=$1`, [fromUserId])).rows[0];
  const to = await findUserByName(toUsername);
  if (!to) throw new CloudError(404, "No collector found with that username.");
  if (to.id === fromUserId) throw new CloudError(400, "You can't trade with yourself.");
  if (!give.length || !want.length) throw new CloudError(400, "Pick at least one card on each side.");
  // You can only trade with friends.
  if (!(await areFriends(fromUserId, to.id))) {
    throw new CloudError(403, `You can only trade with friends. Add ${to.display} as a friend first.`);
  }
  if (!(await canSendOfferTo(fromUserId, to.id))) {
    throw new CloudError(403, `${to.display} only accepts trade requests from certain collectors.`);
  }
  // If this is a counter, retire the original as "countered" (not "declined") so
  // the original sender sees a counter-offer, never a rejection.
  let isCounter = false;
  if (counterOf) {
    const orig = await loadMarketRow(counterOf);
    if (orig && orig.toId === fromUserId && orig.fromId === to.id && orig.offer.status === "pending") {
      orig.offer.status = "countered";
      orig.offer.respondedAt = Date.now();
      await db().query(
        `UPDATE offers SET data = jsonb_set(data, '{offer}', $2::jsonb), updated_at=$3 WHERE id=$1`,
        [`m_${counterOf}`, JSON.stringify(orig.offer), Date.now()]
      );
      isCounter = true;
    }
  }
  const id = newToken().slice(0, 16);
  const offer: MarketOffer = {
    id,
    fromUser: from.username, fromDisplay: from.display,
    toUser: to.username, toDisplay: to.display,
    give, want, status: "pending", createdAt: Date.now(), respondedAt: null,
    ...(isCounter ? { counter: true } : {}),
  };
  await db().query(
    `INSERT INTO offers (id, data, updated_at) VALUES ($1,$2,$3)`,
    [`m_${id}`, JSON.stringify({ market: true, fromId: fromUserId, toId: to.id, offer }), Date.now()]
  );
  const notify = (await settingOf(to.id, "emailOffers")) === true;
  return { id, toDisplay: to.display, toEmail: to.email, notify, counter: isCounter };
}

async function loadMarketRow(id: string): Promise<{ fromId: number; toId: number; offer: MarketOffer } | null> {
  const r = await db().query(`SELECT data FROM offers WHERE id=$1`, [`m_${id}`]);
  const d = r.rows[0]?.data;
  return d && d.market ? { fromId: d.fromId, toId: d.toId, offer: d.offer } : null;
}

/** Incoming (to me) and outgoing (from me) offers for a user. */
export async function listMarketOffers(userId: number): Promise<{ incoming: MarketOffer[]; outgoing: MarketOffer[] }> {
  const r = await db().query(
    `SELECT data FROM offers WHERE (data->>'market')='true' AND ((data->>'toId')=$1 OR (data->>'fromId')=$1) ORDER BY updated_at DESC LIMIT 100`,
    [String(userId)]
  );
  const incoming: MarketOffer[] = [], outgoing: MarketOffer[] = [];
  for (const row of r.rows) {
    const d = row.data;
    if (!d?.offer) continue;
    if (Number(d.toId) === userId) incoming.push(d.offer);
    else if (Number(d.fromId) === userId) outgoing.push(d.offer);
  }
  return { incoming, outgoing };
}

/** Respond to a directed offer. Accept auto-swaps the cards between binders. */
export async function respondMarketOffer(
  userId: number,
  id: string,
  action: "accept" | "decline" | "cancel"
): Promise<{ offer: MarketOffer; fromEmail: string | null; notify: boolean }> {
  const row = await loadMarketRow(id);
  if (!row) throw new CloudError(404, "That offer no longer exists.");
  const { fromId, toId, offer } = row;
  if (offer.status !== "pending") throw new CloudError(409, "This offer was already answered.");
  if (action === "cancel") {
    if (userId !== fromId) throw new CloudError(403, "Only the sender can cancel.");
    offer.status = "cancelled";
  } else {
    if (userId !== toId) throw new CloudError(403, "Only the recipient can accept or decline.");
    offer.status = action === "accept" ? "accepted" : "declined";
  }
  offer.respondedAt = Date.now();

  if (offer.status === "accepted") {
    // Auto-swap using the REAL cards currently in each binder (resolved by id),
    // so the actual card objects move — give: sender→recipient, want: recipient→
    // sender. Cards no longer present (traded/removed since) are simply skipped.
    const now = Date.now();
    const giveIds = new Set(offer.give.map((c) => String(c.id)));
    const wantIds = new Set(offer.want.map((c) => String(c.id)));
    const fromCards = await binderOf(fromId);
    const toCards = await binderOf(toId);
    const givenReal = fromCards.filter((c) => giveIds.has(String(c.id)));
    const wantedReal = toCards.filter((c) => wantIds.has(String(c.id)));
    const newFrom = fromCards.filter((c) => !giveIds.has(String(c.id))).concat(wantedReal.map((c) => reid(c, now)));
    const newTo = toCards.filter((c) => !wantIds.has(String(c.id))).concat(givenReal.map((c) => reid(c, now + 1)));
    await setBinder(fromId, newFrom);
    await setBinder(toId, newTo);
  }

  await db().query(
    `UPDATE offers SET data = jsonb_set(data, '{offer}', $2::jsonb), updated_at=$3 WHERE id=$1`,
    [`m_${id}`, JSON.stringify(offer), Date.now()]
  );
  // Notify the sender of the outcome if they opted into email.
  const from = (await db().query(`SELECT email FROM users WHERE id=$1`, [fromId])).rows[0];
  const notify = (await settingOf(fromId, "emailOffers")) === true;
  return { offer, fromEmail: from?.email ?? null, notify };
}

// --- Friends ---------------------------------------------------------------
export interface FriendUser { username: string; display: string }

export async function areFriends(a: number, b: number): Promise<boolean> {
  const r = await db().query(`SELECT 1 FROM friend_edges WHERE user_id=$1 AND friend_id=$2 AND status='accepted'`, [a, b]);
  return (r.rowCount ?? 0) > 0;
}

/** A → requests → B. */
export async function sendFriendRequest(fromId: number, toName: string): Promise<{ display: string }> {
  const to = await findUserByName(toName);
  if (!to) throw new CloudError(404, "No collector found with that username.");
  if (to.id === fromId) throw new CloudError(400, "You can't friend yourself.");
  const existing = (await db().query(`SELECT status FROM friend_edges WHERE user_id=$1 AND friend_id=$2`, [fromId, to.id])).rows[0];
  if (existing?.status === "accepted") throw new CloudError(409, "You're already friends.");
  const now = Date.now();
  // If THEY already requested US, accept it instead of stacking a request.
  const reverse = (await db().query(`SELECT status FROM friend_edges WHERE user_id=$1 AND friend_id=$2`, [to.id, fromId])).rows[0];
  if (reverse?.status === "pending") {
    await respondFriend(fromId, to.id, true);
    return { display: to.display };
  }
  await db().query(
    `INSERT INTO friend_edges (user_id, friend_id, status, created_at) VALUES ($1,$2,'pending',$3)
     ON CONFLICT (user_id, friend_id) DO NOTHING`,
    [fromId, to.id, now]
  );
  return { display: to.display };
}

/** `userId` responds to a pending request FROM `otherId`. */
export async function respondFriend(userId: number, otherId: number, accept: boolean): Promise<void> {
  const pending = (await db().query(`SELECT 1 FROM friend_edges WHERE user_id=$1 AND friend_id=$2 AND status='pending'`, [otherId, userId])).rows[0];
  if (!pending) throw new CloudError(404, "No pending request from that user.");
  if (!accept) {
    await db().query(`DELETE FROM friend_edges WHERE user_id=$1 AND friend_id=$2`, [otherId, userId]);
    return;
  }
  const now = Date.now();
  await db().query(`UPDATE friend_edges SET status='accepted' WHERE user_id=$1 AND friend_id=$2`, [otherId, userId]);
  await db().query(
    `INSERT INTO friend_edges (user_id, friend_id, status, created_at) VALUES ($1,$2,'accepted',$3)
     ON CONFLICT (user_id, friend_id) DO UPDATE SET status='accepted'`,
    [userId, otherId, now]
  );
}

export async function removeFriend(userId: number, otherName: string): Promise<void> {
  const other = await findUserByName(otherName);
  if (!other) return;
  await db().query(`DELETE FROM friend_edges WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`, [userId, other.id]);
}

async function usersByIds(ids: number[]): Promise<Record<number, FriendUser>> {
  if (!ids.length) return {};
  const r = await db().query(`SELECT id, username, display FROM users WHERE id = ANY($1)`, [ids]);
  const m: Record<number, FriendUser> = {};
  for (const u of r.rows) m[u.id] = { username: u.username, display: u.display };
  return m;
}

export async function listFriends(userId: number): Promise<{ friends: FriendUser[]; incoming: FriendUser[]; outgoing: FriendUser[] }> {
  const rows = (await db().query(
    `SELECT user_id, friend_id, status FROM friend_edges WHERE user_id=$1 OR friend_id=$1`, [userId]
  )).rows;
  const friendIds: number[] = [], incomingIds: number[] = [], outgoingIds: number[] = [];
  for (const e of rows) {
    if (e.status === "accepted" && e.user_id === userId) friendIds.push(e.friend_id);
    else if (e.status === "pending" && e.friend_id === userId) incomingIds.push(e.user_id);
    else if (e.status === "pending" && e.user_id === userId) outgoingIds.push(e.friend_id);
  }
  const info = await usersByIds([...friendIds, ...incomingIds, ...outgoingIds]);
  const map = (ids: number[]) => ids.map((i) => info[i]).filter(Boolean);
  return { friends: map(friendIds), incoming: map(incomingIds), outgoing: map(outgoingIds) };
}

// --- Trade-request privacy: may `fromId` send an offer to `toId`? -----------
export async function canSendOfferTo(fromId: number, toId: number): Promise<boolean> {
  const mode = (await settingOf(toId, "tradeRequestsFrom")) || "anyone";
  if (mode === "anyone") return true;
  if (mode === "friends") return areFriends(toId, fromId);
  if (mode === "list") {
    const allow = (await settingOf(toId, "tradeAllowList")) as unknown;
    const from = (await db().query(`SELECT username, display FROM users WHERE id=$1`, [fromId])).rows[0];
    const names = (Array.isArray(allow) ? allow : []).map((x) => String(x).trim().toLowerCase());
    return names.includes((from?.username || "").toLowerCase()) || names.includes((from?.display || "").toLowerCase());
  }
  return true;
}

// --- Direct messages (marketplace chat) ------------------------------------
export interface ChatMsg { id: number; from: string; mine: boolean; body: string; at: number }

export async function sendMessage(fromId: number, toName: string, body: string): Promise<void> {
  const text = (body || "").trim().slice(0, 2000);
  if (!text) throw new CloudError(400, "Message is empty.");
  const to = await findUserByName(toName);
  if (!to) throw new CloudError(404, "No collector found with that username.");
  if (to.id === fromId) throw new CloudError(400, "You can't message yourself.");
  await db().query(`INSERT INTO messages (from_id, to_id, body, created_at) VALUES ($1,$2,$3,$4)`, [fromId, to.id, text, Date.now()]);
}

export async function loadThread(userId: number, otherName: string, afterId = 0): Promise<ChatMsg[]> {
  const other = await findUserByName(otherName);
  if (!other) return [];
  const r = await db().query(
    `SELECT id, from_id, body, created_at FROM messages
      WHERE ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)) AND id > $3
      ORDER BY id ASC LIMIT 200`,
    [userId, other.id, afterId]
  );
  return r.rows.map((m) => ({ id: Number(m.id), from: other.display, mine: m.from_id === userId, body: m.body, at: Number(m.created_at) }));
}

/** Distinct people the user has a conversation with, most-recent first. */
export async function listThreads(userId: number): Promise<{ username: string; display: string; last: string; at: number }[]> {
  const r = await db().query(
    `SELECT other, display, username, body, created_at FROM (
       SELECT DISTINCT ON (other) other, m.body, m.created_at
       FROM (
         SELECT CASE WHEN from_id=$1 THEN to_id ELSE from_id END AS other, body, created_at
         FROM messages WHERE from_id=$1 OR to_id=$1
       ) m ORDER BY other, created_at DESC
     ) x JOIN users u ON u.id = x.other ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return r.rows.map((t) => ({ username: t.username, display: t.display, last: t.body, at: Number(t.created_at) }));
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
  // The checks above can race (two signups at once), so rely on the DB's unique
  // constraints as the real guard and translate a violation into a clear message.
  let id: number;
  try {
    id = (await p.query(
      `INSERT INTO users (username, display, email, provider, salt, hash, created_at)
       VALUES ($1,$2,$3,'local',$4,$5,$6) RETURNING id`,
      [uname, display, email.trim(), salt, hash, now]
    )).rows[0].id as number;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err?.code === "23505") {
      throw new CloudError(409, /email/i.test(err.constraint || "")
        ? "An account with that email already exists. Try logging in instead."
        : "That username is already taken.");
    }
    throw e;
  }
  await p.query(`INSERT INTO user_data (user_id, blob, version, updated_at) VALUES ($1,'{}'::jsonb,0,$2)`, [id, now]);
  const token = newToken();
  await p.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, id, now]);
  return loadAuth(id, token);
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const p = db();
  const id = key(username);
  // Accept EITHER the username or the account's email — people routinely type
  // their email at the login box and were being told "no account with that name".
  const u = (await p.query(
    `SELECT id, salt, hash, provider FROM users WHERE username=$1 OR LOWER(email)=$1 LIMIT 1`,
    [id]
  )).rows[0];
  if (!u) throw new CloudError(401, "No account with that username or email.");
  if (u.provider !== "local" || !u.salt || !u.hash) {
    throw new CloudError(401, "This account signs in with Google — use “Continue with Google”.");
  }
  if (!sameHash(hashPw(password, u.salt), u.hash)) throw new CloudError(401, "Incorrect password.");
  const token = newToken();
  const now = Date.now();
  await p.query(`INSERT INTO sessions (token, user_id, created_at, last_used) VALUES ($1,$2,$3,$3)`, [token, u.id, now]);
  return loadAuth(u.id, token);
}

// Sessions don't live forever: a token unused for this long stops working, so a
// leaked or forgotten token on an old device can't be used indefinitely. Any use
// slides the window forward, so active users are never logged out.
const SESSION_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function userForToken(token: string): Promise<number | null> {
  if (!token) return null;
  const p = db();
  const r = await p.query(`SELECT user_id, created_at, last_used FROM sessions WHERE token=$1`, [token]);
  const row = r.rows[0];
  if (!row) return null;
  const now = Date.now();
  const lastSeen = Number(row.last_used ?? row.created_at ?? 0);
  if (lastSeen && now - lastSeen > SESSION_MAX_IDLE_MS) {
    await p.query(`DELETE FROM sessions WHERE token=$1`, [token]).catch(() => {});
    return null;
  }
  // Slide the idle window (throttled: only write once an hour per token).
  if (!lastSeen || now - lastSeen > 60 * 60 * 1000) {
    p.query(`UPDATE sessions SET last_used=$2 WHERE token=$1`, [token, now]).catch(() => {});
  }
  return row.user_id ?? null;
}

/**
 * What the community actually trades. Every ACCEPTED offer is a real data point
 * about which players get swapped for which — far better evidence than a model's
 * guess. One trade proves nothing, so we only report pairings seen repeatedly.
 */
export async function tradePatterns(minCount = 3, limit = 40): Promise<string[]> {
  if (!hasCloud) return [];
  try {
    const rows = (await db().query(
      `SELECT data FROM offers WHERE (data->>'market')='true' ORDER BY updated_at DESC LIMIT 500`
    )).rows;
    const subject = (c: { result?: { player?: string } }) => (c?.result?.player || "").trim().toLowerCase();
    const tally = new Map<string, { a: string; b: string; n: number }>();
    for (const r of rows) {
      const o = r.data?.offer;
      if (!o || o.status !== "accepted") continue;
      const gave = [...new Set((o.give || []).map(subject).filter(Boolean))] as string[];
      const got = [...new Set((o.want || []).map(subject).filter(Boolean))] as string[];
      for (const a of gave) for (const b of got) {
        if (a === b) continue;
        const [x, y] = a < b ? [a, b] : [b, a]; // unordered pair
        const k = `${x}|${y}`;
        const cur = tally.get(k) || { a: x, b: y, n: 0 };
        cur.n++;
        tally.set(k, cur);
      }
    }
    const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
    return [...tally.values()]
      .filter((p) => p.n >= minCount)
      .sort((p, q) => q.n - p.n)
      .slice(0, limit)
      .map((p) => `${title(p.a)} ↔ ${title(p.b)} (traded straight up ${p.n}×)`);
  } catch { return []; }
}

/** Sign out every device for a user (e.g. after a password reset). */
export async function revokeAllSessions(userId: number): Promise<void> {
  await db().query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
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
  // Compare the code in constant time so it can't be guessed a digit at a time.
  const given = Buffer.from((code || "").trim());
  const want = Buffer.from(String(row?.code ?? ""));
  const codeOk = !!row && given.length === want.length && timingSafeEqual(given, want);
  if (!codeOk || Date.now() > Number(row.expires)) {
    throw new CloudError(400, "That code is wrong or expired.");
  }
  const salt = newSalt();
  const hash = hashPw(password, salt);
  const users = (await p.query(
    `UPDATE users SET salt=$2, hash=$3 WHERE LOWER(email)=$1 RETURNING id`, [lower, salt, hash]
  )).rows;
  await p.query(`DELETE FROM reset_codes WHERE email=$1`, [lower]);
  // A reset means "someone may have had access" — sign out every other device.
  for (const u of users) await revokeAllSessions(u.id).catch(() => {});
}
