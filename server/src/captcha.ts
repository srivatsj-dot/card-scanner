/**
 * Bot protection for the login and signup screens.
 *
 * The picture is drawn here, pixel by pixel, and sent as a PNG — so the answer
 * never appears anywhere in the page. A script has to actually read warped,
 * speckled, overdrawn characters instead of lifting a string out of the JSON.
 *
 * There is no image library on the server (and none is worth adding for this),
 * so the glyphs come from a small bitmap font below and the PNG is encoded by
 * hand with zlib. It costs about a millisecond per challenge.
 *
 * A spoken-word arithmetic question is offered as the accessible alternative,
 * because an image-only check locks out anyone using a screen reader.
 */
import { deflateSync } from "node:zlib";
import { randomBytes, randomInt } from "node:crypto";

// Characters that can't be confused with each other when they're distorted:
// no 0/O, no 1/I/l, no 5/S, no 2/Z, no 8/B.
const CHARS = "34679ACDEFGHJKLMNPQRTUVWXY";
const LEN = 5;

// 5×7 bitmap font, one row per string. Only the characters above are needed.
const FONT: Record<string, string[]> = {
  "3": ["#####", "....#", "...#.", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  A: ["..#..", ".#.#.", "#...#", "#...#", "#####", "#...#", "#...#"],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
};

const W = 280, H = 90;
const SS = 3; // supersampling factor — the mask is drawn at 3× and averaged down

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A dark, readable ink colour with enough hue variation to defeat colour keying. */
function ink(): [number, number, number] {
  const h = Math.random() * 360, s = rnd(0.45, 0.85), l = rnd(0.22, 0.4);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** One cell of a glyph, 1 when inked; anything off the grid is blank. */
function on(glyph: string[], row: number, col: number): number {
  if (row < 0 || row > 6 || col < 0 || col > 4) return 0;
  return glyph[row][col] === "#" ? 1 : 0;
}

/**
 * Draw the text into a supersampled mask. Every set pixel holds the index of
 * the glyph that painted it (1-based), so each character can keep its own
 * colour when the mask is resolved.
 */
function drawText(text: string): { mask: Uint8Array; colors: [number, number, number][] } {
  const mw = W * SS, mh = H * SS;
  const mask = new Uint8Array(mw * mh);
  const colors: [number, number, number][] = [];

  const slot = (W - 24) / text.length;
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]];
    colors.push(ink());
    // Each character gets its own size, tilt, shear and baseline offset, so the
    // spacing a segmenter would look for is never the same twice.
    const px = rnd(7, 8.4) * SS;                   // pixel size of one font cell
    const py = rnd(6.6, 8) * SS;
    const angle = rnd(-0.3, 0.3);
    const shear = rnd(-0.18, 0.18);
    const cx = (12 + slot * (i + 0.5) + rnd(-3, 3)) * SS;
    const cy = (H / 2 + rnd(-5, 5)) * SS;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const halfW = (5 * px) / 2, halfH = (7 * py) / 2;
    // Walk a generous box around the glyph and inverse-transform each pixel.
    const reach = Math.ceil(Math.max(halfW, halfH) * 1.7);
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(mh, cy + reach); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(mw, cx + reach); x++) {
        const dx = x - cx, dy = y - cy;
        let ux = dx * cos + dy * sin;
        const uy = -dx * sin + dy * cos;
        ux -= uy * shear;
        // Sample the font grid SMOOTHLY. Nearest-neighbour turns a 5×7 font into
        // Minecraft at this scale; interpolating between cells and thresholding
        // gives rounded, marker-pen strokes that a person can actually read.
        const gx = (ux + halfW) / px - 0.5;
        const gy = (uy + halfH) / py - 0.5;
        if (gy < -1 || gy > 7 || gx < -1 || gx > 5) continue;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const tx = gx - x0, ty = gy - y0;
        const v =
          on(glyph, y0, x0) * (1 - tx) * (1 - ty) +
          on(glyph, y0, x0 + 1) * tx * (1 - ty) +
          on(glyph, y0 + 1, x0) * (1 - tx) * ty +
          on(glyph, y0 + 1, x0 + 1) * tx * ty;
        if (v >= 0.42) mask[y * mw + x] = i + 1;
      }
    }
  }
  return { mask, colors };
}

/**
 * Paint the background clutter first, then lay the sine-warped text over it.
 * Order matters: strokes drawn OVER the characters make the picture unreadable
 * for people long before it troubles a bot.
 */
function render(text: string): Buffer {
  const { mask, colors } = drawText(text);
  const mw = W * SS, mh = H * SS;
  const rgb = new Uint8Array(W * H * 3);

  // Paper: a soft two-tone wash, so a plain background subtraction gets nowhere.
  const bg1 = [rnd(232, 252), rnd(232, 252), rnd(232, 252)];
  const bg2 = [rnd(214, 244), rnd(214, 244), rnd(214, 244)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x / W) * 0.5 + (y / H) * 0.5;
      const noise = rnd(-8, 8);
      const o = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = bg1[ch] + (bg2[ch] - bg1[ch]) * t + noise;
        rgb[o + ch] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }

  // Curved strokes, in ink colours, so a line can't be told from a stem by
  // colour alone. Thin and blended, so they clutter without burying anything.
  const strokes = 2;
  for (let s = 0; s < strokes; s++) {
    const c = ink();
    const amp = rnd(6, 18), freq = rnd(0.01, 0.04), ph = Math.random() * 6.28;
    const base = rnd(16, H - 16), thick = rnd(0.6, 1.2);
    for (let x = 0; x < W; x++) {
      const yc = base + amp * Math.sin(x * freq + ph);
      for (let dy = -thick; dy <= thick; dy += 0.5) {
        const y = Math.round(yc + dy);
        if (y < 0 || y >= H) continue;
        const o = (y * W + x) * 3;
        for (let ch = 0; ch < 3; ch++) rgb[o + ch] = Math.round(rgb[o + ch] * 0.35 + c[ch] * 0.65);
      }
    }
  }

  // Speckle: scattered dots at the same weight as the ink, to break up any
  // simple connected-component pass.
  for (let i = 0; i < 400; i++) {
    const o = (randomInt(H) * W + randomInt(W)) * 3;
    const c = ink();
    for (let ch = 0; ch < 3; ch++) rgb[o + ch] = Math.round(rgb[o + ch] * 0.4 + c[ch] * 0.6);
  }

  // The text goes on last. Independent waves on each axis put the characters on
  // a wobbling line that no fixed template can match.
  const ax = rnd(1, 2.5) * SS, fx = rnd(0.018, 0.05) / SS, phx = Math.random() * 6.28;
  const ay = rnd(1.5, 3) * SS, fy = rnd(0.012, 0.035) / SS, phy = Math.random() * 6.28;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hits = 0, who = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const mx0 = x * SS + sx, my0 = y * SS + sy;
          const mx = Math.round(mx0 + ax * Math.sin(my0 * fx + phx));
          const my = Math.round(my0 + ay * Math.sin(mx0 * fy + phy));
          if (mx < 0 || my < 0 || mx >= mw || my >= mh) continue;
          const v = mask[my * mw + mx];
          if (v) { hits++; who = v; }
        }
      }
      if (!hits) continue;
      const cov = hits / (SS * SS);
      const fg = colors[who - 1];
      const o = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        rgb[o + ch] = Math.round(rgb[o + ch] * (1 - cov) + fg[ch] * cov);
      }
    }
  }

  return pngEncode(rgb);
}

// --- Minimal PNG writer ----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngEncode(rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Challenge store -------------------------------------------------------

interface Challenge { answer: string; issued: number; expires: number }
const challenges = new Map<string, Challenge>();
const TTL_MS = 10 * 60 * 1000;
/** Nobody types five characters in under a second — a form that fast is a script. */
const MIN_SOLVE_MS = 1200;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function newId(): string {
  // Prune expired entries so the map can't grow without bound.
  const now = Date.now();
  if (challenges.size > 3000) for (const [k, c] of challenges) if (c.expires < now) challenges.delete(k);
  return randomBytes(12).toString("hex");
}

function store(answer: string): string {
  const id = newId();
  const now = Date.now();
  challenges.set(id, { answer: answer.toLowerCase(), issued: now, expires: now + TTL_MS });
  return id;
}

/** A picture of five characters. The answer is only ever held here. */
export function imageChallenge(): { mode: "image"; id: string; image: string } {
  let text = "";
  for (let i = 0; i < LEN; i++) text += CHARS[randomInt(CHARS.length)];
  const png = render(text);
  return { mode: "image", id: store(text), image: `data:image/png;base64,${png.toString("base64")}` };
}

/** The accessible alternative: a spelled-out sum, readable by a screen reader. */
export function textChallenge(): { mode: "question"; id: string; question: string } {
  // Pick the SUM first and split it, so every number in the question has a word.
  const sum = 4 + randomInt(WORDS.length - 4); // 4…12
  const b = 1 + randomInt(sum - 2);            // 1…sum-2, so a stays ≥ 2
  const a = sum - b;
  const plus = Math.random() < 0.7;
  const question = plus
    ? `What is ${WORDS[a]} plus ${WORDS[b]}?`
    : `What is ${WORDS[sum]} minus ${WORDS[b]}?`;
  return { mode: "question", id: store(String(plus ? sum : a)), question };
}

export interface Proof { captchaId?: string; captchaAnswer?: string; hp?: string }

/**
 * Check a submitted answer. Returns null when it's fine, or a message to show.
 * Challenges are SINGLE USE — right or wrong — so solving one can't be replayed
 * across thousands of signups.
 */
export function verify(proof: Proof): string | null {
  // Honeypot: a field that is invisible and off the tab order, so only something
  // filling in every input it finds will have touched it.
  if (proof.hp) return "That looked automated. Please reload the page and try again.";

  const c = proof.captchaId ? challenges.get(proof.captchaId) : undefined;
  if (!c) return "Please complete the check below.";
  challenges.delete(proof.captchaId as string);
  const now = Date.now();
  if (now > c.expires) return "That check expired — here's a fresh one.";
  if (now - c.issued < MIN_SOLVE_MS) return "That was a little too quick — please try the new one.";

  const given = String(proof.captchaAnswer ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!given) return "Please complete the check below.";
  // Numbers may be typed as digits or spelled out.
  const asWord = WORDS.indexOf(given);
  if (given === c.answer || (asWord >= 0 && String(asWord) === c.answer)) return null;
  return "That wasn't right — please try the new one.";
}

// --- Per-IP issuing limit --------------------------------------------------
// Farming thousands of challenges to solve offline should cost something too.
const issued = new Map<string, number[]>();
const ISSUE_WINDOW_MS = 10 * 60 * 1000;
const ISSUE_MAX = 60;

export function issueLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (issued.get(ip) || []).filter((t) => now - t < ISSUE_WINDOW_MS);
  if (hits.length >= ISSUE_MAX) { issued.set(ip, hits); return true; }
  hits.push(now);
  issued.set(ip, hits);
  if (issued.size > 5000) issued.clear();
  return false;
}
