import "./env.js";
import express from "express";
import cors from "cors";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import type { Request, Response } from "express";
import { ApiError } from "@google/genai";
import { ai, MODEL, hasApiKey } from "./gemini.js";
import { ebayPrice, ebayImageSearch, hasEbay } from "./ebay.js";
import { pokemonLookup } from "./prices.js";
import { webDetect, hasVision } from "./vision.js";
import * as cloud from "./cloud.js";
import { verifiedSportsFacts, verifiedSportsFactsData, hasLimitless } from "./sports.js";
import { scanSchema, tradeSchema, askSchema, bulkSchema, tradeUpSchema, digestSchema, checklistSchema, priceVerifySchema } from "./schemas.js";
import {
  scanSystemPrompt,
  bulkSystemPrompt,
  tradeSystemPrompt,
  askSystemPrompt,
  offerSystemPrompt,
  tradeUpSystemPrompt,
  digestSystemPrompt,
  checklistSystemPrompt,
  verifyPriceSystemPrompt,
  chatSystemPrompt,
  type Settings,
} from "./prompts.js";

const app = express();
app.use(cors());
// Card photos arrive as base64 JSON, so allow a generous body size.
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT) || 8787;

// The morning digest only reports news from this date onward (avoids stale or
// hallucinated old events). The briefing archive officially starts here.
const LAUNCH_DATE = "2026-06-19";

// Google Search grounding gives the model live data (current player form,
// recent sale prices) instead of its early-2025 training knowledge. On by
// default; set CARD_SCANNER_GROUNDING=false to disable (one fewer API call).
const USE_GROUNDING = process.env.CARD_SCANNER_GROUNDING !== "false";

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Shift a YYYY-MM-DD date by n days (UTC, no time component).
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// Pull any calendar dates MENTIONED in an item's prose ("June 19", "6/19",
// "2026-06-19") and return them as YYYY-MM-DD against a reference year. Lets us
// drop items that brag about an out-of-window day even when their leading tag
// was (mis)stamped inside the window to sneak past the tag filter.
function datesInProse(text: string, year: number): string[] {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  const reMD = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
  while ((m = reMD.exec(lower))) { const mo = MONTHS[m[1]]; const d = Number(m[2]); if (mo && d >= 1 && d <= 31) out.push(`${year}-${pad(mo)}-${pad(d)}`); }
  const reDM = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/g;
  while ((m = reDM.exec(lower))) { const mo = MONTHS[m[2]]; const d = Number(m[1]); if (mo && d >= 1 && d <= 31) out.push(`${year}-${pad(mo)}-${pad(d)}`); }
  const reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = reISO.exec(lower))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const reSlash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = reSlash.exec(lower))) { const mo = Number(m[1]); const d = Number(m[2]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${year}-${pad(mo)}-${pad(d)}`); }
  return out;
}

// Digest items must start with the event's real date as "[YYYY-MM-DD]". Keep
// only items whose tagged date AND every date mentioned in the prose fall inside
// the window; drop anything older, newer, or undated — then strip the tag for
// display. Enforces the window deterministically instead of trusting the model.
function keepInWindow(items: unknown, start: string, end: string): string[] {
  if (!Array.isArray(items)) return [];
  const year = Number(start.slice(0, 4));
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const m = /^\s*[\[(]?(\d{4}-\d{2}-\d{2})[\])]?[\s:.,-]*/.exec(raw);
    // If the item carries a leading [date] tag, honor it strictly: drop anything
    // tagged outside the window. If it has NO tag, keep it — the model is
    // grounded on this window, and dropping every untagged item was nuking real
    // news and leaving an empty briefing under a full headline.
    let text = raw.trim();
    if (m) {
      if (m[1] < start || m[1] > end) continue; // tagged outside the window → drop
      text = raw.slice(m[0].length).trim();
    }
    if (!text) continue;
    // Still reject anything whose sentence cites a day outside the window — that
    // catches stale events even when they slip in without a leading tag.
    if (datesInProse(text, year).some((d) => d < start || d > end)) continue;
    out.push(text);
  }
  return out;
}

interface DigestShape {
  overview: string;
  yourCards: unknown;
  yourWishlist: unknown;
  sections?: Array<{
    sport: string;
    risingStars: unknown; declining: unknown; storylines: unknown;
    trades: unknown; chase: unknown; news: unknown;
  }>;
}

function apiKeyGuard(res: Response): boolean {
  if (!hasApiKey) {
    res.status(503).json({
      error: "The scanner is temporarily unavailable. Please try again later.",
    });
    return false;
  }
  return true;
}

function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return {
        status: 429,
        message: "We're a bit busy right now. Please wait a minute and try again.",
      };
    }
    if (err.status === 400 && /api key/i.test(err.message)) {
      return { status: 503, message: "The scanner is temporarily unavailable. Please try again later." };
    }
    return { status: err.status || 500, message: "Something went wrong. Please try again." };
  }
  return { status: 500, message: "Something went wrong. Please try again." };
}

/** Pull JSON out of a Gemini response, tolerating accidental ```json fences. */
// Gemini, when asked for raw JSON text (grounded calls), sometimes drops the
// backslash from a \u00XX escape for accented Latin letters — leaving the literal
// "00ed" mid-word ("Rodr00edguez" for "Rodríguez", "Pe00f1a" for "Peña"). That's
// valid JSON, so it survives parsing. Restore those: a "00" + Latin-1 hex byte
// (C0–FF, the accented-letter range) sitting between two letters.
function repairBotchedEscapes(s: string): string {
  // A botched "00XX" must touch a letter on at least one side and never a digit
  // (so real numbers like "1000ed" or "2.00e9" are left alone).
  return s.replace(
    /(?<=[A-Za-zÀ-ÿ])00([c-f][0-9a-f])(?![0-9])|(?<![0-9])00([c-f][0-9a-f])(?=[A-Za-zÀ-ÿ])/gi,
    (_m, h1, h2) => String.fromCharCode(parseInt(h1 || h2, 16))
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepRepair(v: any): any {
  if (typeof v === "string") return repairBotchedEscapes(v);
  if (Array.isArray(v)) return v.map(deepRepair);
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) v[k] = deepRepair(v[k]);
  }
  return v;
}

function parseJson<T>(text: string | undefined): T {
  if (!text) throw new Error("The model returned an empty response.");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return deepRepair(JSON.parse(cleaned)) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Low temperature for identification/appraisal — less guessing and more
// consistent extraction than the default sampling.
const ANALYZE_TEMPERATURE = 0.2;

// gemini-2.5-flash has "thinking" on by default; combined with grounding it can
// spend the whole output budget on hidden thoughts and return empty text.
// Disable thinking for these structured calls and give a generous output cap.
const NO_THINKING = { thinkingBudget: 0 } as const;
const MAX_OUTPUT = 8192;
// Let the model "think" on card identification — more accurate reads of sets,
// parallels, and serials, while staying quick. Other calls stay at 0.
const SCAN_THINKING = 1024;

// Try the configured model first (best accuracy), then fall back to flash-lite
// which has a separate, more generous free-tier quota. Lets a rate-limited
// request still complete instead of erroring.
export const MODELS = Array.from(new Set([MODEL, "gemini-2.5-flash-lite"]));

const isRateLimit = (err: unknown) => err instanceof ApiError && err.status === 429;

// Grounding is on when the server default is on AND the user hasn't turned off
// "live data" in settings. Lets users cut quota usage without restarting.
const groundedFor = (settings?: Settings) => USE_GROUNDING && settings?.liveData !== false;

/**
 * Single grounded call that returns JSON. Google Search grounding can't be
 * combined with responseSchema, so we ask for JSON in the prompt and parse it.
 */
async function groundedJson<T>(model: string, systemInstruction: string, parts: Part[], schema: unknown, thinkingBudget = 0): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: { thinkingBudget },
      systemInstruction:
        systemInstruction +
        `\n\nToday's date is ${today()}. Use Google Search to verify the subject's CURRENT form/standing and the card's CURRENT market value — do not rely on memory for anything time-sensitive.` +
        `\n\nRespond with ONLY a single JSON object (no markdown fences, no commentary) conforming to this JSON schema:\n${JSON.stringify(schema)}` +
        `\n\nWrite all non-ASCII text (accented names like "Rodríguez", "Peña", "Ohtani") as literal UTF-8 characters. Do NOT use \\uXXXX escape sequences.`,
      tools: [{ googleSearch: {} }],
    },
  });
  const text = response.text;
  if (!text) throw new Error("The model returned an empty response.");
  try {
    return parseJson<T>(text);
  } catch {
    return structure<T>(model, systemInstruction, text, schema, thinkingBudget);
  }
}

/** Reshape free text into the structured schema (fallback / non-grounded helper). */
async function structure<T>(model: string, systemInstruction: string, analysis: string, schema: unknown, thinkingBudget = 0): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents:
      "Convert the following analysis into the required JSON. Use only facts present in the analysis; do not invent new details.\n\n" +
      analysis,
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: { thinkingBudget },
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/** Single-pass structured generation, no grounding. */
async function structuredDirect<T>(model: string, systemInstruction: string, parts: Part[], schema: unknown, thinkingBudget = 0): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: { thinkingBudget },
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/**
 * Produce a structured result, preferring live grounding and the best model,
 * but degrading gracefully: a non-429 grounding failure drops grounding on the
 * same model; a rate limit moves on to the next (higher-quota) model.
 */
async function analyze<T>(systemInstruction: string, parts: Part[], schema: unknown, grounded: boolean, thinkingBudget = 0): Promise<T> {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      if (!grounded) return await structuredDirect<T>(model, systemInstruction, parts, schema, thinkingBudget);
      try {
        return await groundedJson<T>(model, systemInstruction, parts, schema, thinkingBudget);
      } catch (err) {
        if (isRateLimit(err)) throw err; // let the model-fallback loop handle it
        return await structuredDirect<T>(model, systemInstruction, parts, schema, thinkingBudget); // empty/grounding issue
      }
    } catch (err) {
      lastErr = err;
      if (isRateLimit(err)) continue; // try the next model's separate quota
      throw err;
    }
  }
  throw lastErr;
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, provider: "google-gemini", model: MODEL, grounding: USE_GROUNDING, hasApiKey, cloud: cloud.hasCloud, email: emailStatus() });
});

// --- eBay Marketplace Account Deletion / Closure notifications --------------
// eBay disables every production keyset until you register an endpoint that
// (a) answers their verification challenge and (b) accepts deletion notices.
// We store NO eBay user data, so notifications are simply acknowledged. Set
// EBAY_VERIFICATION_TOKEN (a 32–80 char secret you also paste into eBay) and
// EBAY_DELETION_ENDPOINT (the exact public URL of this route) to enable it.
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "";
const EBAY_DELETION_ENDPOINT = process.env.EBAY_DELETION_ENDPOINT || "";
app.get("/api/ebay/deletion", (req: Request, res: Response) => {
  const challengeCode = String(req.query.challenge_code || "");
  if (!challengeCode) { res.status(400).json({ error: "missing challenge_code" }); return; }
  if (!EBAY_VERIFICATION_TOKEN || !EBAY_DELETION_ENDPOINT) {
    res.status(503).json({ error: "eBay deletion endpoint not configured (set EBAY_VERIFICATION_TOKEN and EBAY_DELETION_ENDPOINT)." });
    return;
  }
  // eBay's required hash: sha256(challengeCode + verificationToken + endpoint).
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(EBAY_VERIFICATION_TOKEN);
  hash.update(EBAY_DELETION_ENDPOINT);
  res.status(200).json({ challengeResponse: hash.digest("hex") });
});
app.post("/api/ebay/deletion", (_req: Request, res: Response) => {
  // No eBay user data is stored, so there's nothing to erase — just acknowledge.
  res.status(200).json({ ok: true });
});

// --- Scan a card (one or more photos: front, back, angled) -----------------
app.post("/api/scan", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const body = req.body as {
    images?: { imageBase64: string; mediaType: string }[];
    imageBase64?: string; // legacy single-image support
    mediaType?: string;
    text?: string; // typed card description (photo optional)
    settings?: Settings;
  };
  const settings = body.settings;
  const text = body.text?.trim() || "";

  // Accept either the new images[] array or a single legacy image.
  const images =
    body.images && body.images.length > 0
      ? body.images
      : body.imageBase64 && body.mediaType
      ? [{ imageBase64: body.imageBase64, mediaType: body.mediaType }]
      : [];

  if (images.length === 0 && !text) {
    res.status(400).json({ error: "Add a photo or type a card description." });
    return;
  }
  const bad = images.find((im) => !ALLOWED_MEDIA.has(im.mediaType));
  if (bad) {
    res.status(400).json({ error: `Unsupported image type: ${bad.mediaType}` });
    return;
  }

  const sys = scanSystemPrompt(settings || {}, images.length > 0);
  const imageParts: Part[] = images.map((im) => ({
    inlineData: { mimeType: im.mediaType, data: im.imageBase64 },
  }));
  const intro =
    images.length > 1
      ? `These ${images.length} photos are of the SAME single card (e.g. front, back, and/or angled shots). Use ALL of them together — the back and angled shots often reveal the card number, set, serial numbering, and whether a parallel/refractor finish is present. `
      : "";
  const describedAs = text
    ? images.length > 0
      ? `The collector adds this description (use it to resolve ambiguity): "${text}". `
      : `Look up the card the collector describes: "${text}". `
    : "";
  const task =
    images.length > 0
      ? "Identify this exact trading card (subject, set, year, card number, parallel, serial number, special edition), "
      : "Identify the described card as specifically as you can (subject, set, year, card number, parallel, special edition); if the description is ambiguous, note assumptions in warnings. ";
  const scanParts: Part[] = [
    ...imageParts,
    {
      text:
        intro +
        describedAs +
        task +
        "then research current value and the subject's current form, and return the full structured analysis.",
    },
  ];

  try {
    // Photo-based identification boosters (run together): both feed the model a
    // strong hint of what the card is, from matching the EXACT photo online.
    if (images.length > 0) {
      const [guess, ebayMatch] = await Promise.all([
        hasVision ? webDetect(images[0].imageBase64).catch(() => null) : Promise.resolve(null),
        hasEbay ? ebayImageSearch(images[0].imageBase64, settings?.region).catch(() => ({ titles: [], price: null })) : Promise.resolve({ titles: [] as string[], price: null }),
      ]);
      // eBay image search: matching listing TITLES already carry the right
      // player/set/year/number — the strongest single ID signal we have.
      if (ebayMatch.titles.length) {
        scanParts.unshift({
          text:
            `eBay IMAGE SEARCH of this exact photo returned these matching listing titles (most relevant first):\n- ${ebayMatch.titles.join("\n- ")}\n` +
            `These are real listings of the same card. Use them as a STRONG hint for the player, set, year, card number, and parallel — but still trust exactly what's printed on the card if they conflict.`,
        });
      }
      // Reverse-image search (Google Vision) on the photo: the web's best guess.
      if (guess && (guess.bestGuess || guess.entities.length)) {
        scanParts.unshift({
          text:
            `REVERSE-IMAGE SEARCH of this exact photo (Google) suggests: ` +
            (guess.bestGuess ? `"${guess.bestGuess}"` : "") +
            (guess.entities.length ? `${guess.bestGuess ? "; related: " : ""}${guess.entities.join(", ")}` : "") +
            `. Use this as a strong hint for the player, set, year, and product — but still trust exactly what's printed on the card if they conflict.`,
        });
      }
    }
    // A photo scan identifies from the image alone (no web grounding) so it
    // returns fast; a text-only lookup keeps grounding since it has no image to
    // read. Real pricing follows: the Pokémon catalog here, and the grounded
    // sold-comp double-check off the critical path via /api/price-check.
    const grounded = images.length > 0 ? false : groundedFor(settings);
    const result = await analyze<ScanResultShape>(sys, scanParts, scanSchema, grounded, SCAN_THINKING);
    const ebayApplied = await applyEbayPrice(result, settings);
    if (!ebayApplied && isPokemon(result)) await applyPokemonPrice(result); // free real Pokémon prices
    res.json(result);
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// Off-critical-path price double-check: the client calls this after showing a
// scan/search result to refine the value against recent sold comps. Pokémon and
// eBay-priced cards already have real prices, so they're returned unchanged.
app.post("/api/price-check", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { card, settings } = req.body as { card?: ScanResultShape; settings?: Settings };
  const result = card || {};
  try {
    if (result.identified && result.estimatedValue && !isPokemon(result)) {
      // eBay-first: real eBay data always wins. If the scan already set an
      // eBay-based price, keep it untouched — do NOT let the AI sold-comp pass
      // overwrite real listing data with an estimate. Only when there's no eBay
      // price for this card do we fall back to the grounded verify pass.
      const alreadyEbay = /ebay/i.test(result.estimatedValue.note || "");
      const applied = alreadyEbay ? true : await applyEbayPrice(result, settings);
      if (!applied) await verifyPrice(result, settings);
    }
  } catch {
    /* keep the original estimate */
  }
  res.json({ estimatedValue: result.estimatedValue });
});

// Minimal shape we need to read/override on a scan result.
interface ScanResultShape {
  identified?: boolean;
  player?: string | null;
  sport?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  specialEdition?: string | null;
  serialNumber?: string | null;
  estimatedCondition?: string | null;
  pokemon?: { setNumber?: string | null; rarity?: string | null } | null;
  estimatedValue?: { low: number; mid: number; high: number; currency: string; note: string };
}

const isPokemon = (r: ScanResultShape) => /pok[eé]mon/i.test(r.sport || "");

interface PriceVerifyShape {
  low: number; mid: number; high: number; currency: string;
  confidence: string; comps: string[]; note: string;
}

// Second pass: re-price the card against real recent SOLD comps and overwrite
// the estimate. Always runs (and always searches live comps) so prices stay
// accurate. Skipped only when a real-data price (eBay/Pokémon catalog) already
// set it. Best-effort — leaves the first estimate intact on any error.
async function verifyPrice(result: ScanResultShape, settings?: Settings) {
  if (!result?.identified || !result.estimatedValue) return;
  const desc = cardQuery(result);
  if (!desc) return;
  const v = result.estimatedValue;
  try {
    const checked = await analyze<PriceVerifyShape>(
      verifyPriceSystemPrompt(settings || {}),
      [{
        text:
          `Verify the market value of this exact card against recent SOLD comps and correct it if needed.\n` +
          `Card: ${desc}\n` +
          `Condition: ${result.estimatedCondition || "raw / ungraded (unless a grade is noted)"}\n` +
          `Draft estimate to check: ${v.currency} — low ${v.low}, mid ${v.mid}, high ${v.high}.`,
      }],
      priceVerifySchema,
      true, // always ground — the whole point is real sold comps
      1024
    );
    if (checked && [checked.low, checked.mid, checked.high].every((n) => Number.isFinite(n) && n >= 0)) {
      const conf = checked.confidence ? `, ${checked.confidence} confidence` : "";
      result.estimatedValue = {
        low: checked.low,
        mid: checked.mid,
        high: checked.high,
        currency: checked.currency || v.currency,
        note: (checked.note || v.note) + (checked.comps?.length ? ` (verified vs sold comps${conf})` : ""),
      };
    }
  } catch {
    /* keep the draft estimate */
  }
}

function cardQuery(r: ScanResultShape): string {
  return [r.year, r.manufacturer, r.setName, r.player, r.parallel, r.cardNumber ? `#${r.cardNumber}` : "", r.serialNumber]
    .map((x) => (x || "").toString().trim())
    .filter(Boolean)
    .join(" ");
}

// Replace the model's value with a real eBay-listings range when available.
async function applyEbayPrice(result: ScanResultShape, settings?: Settings): Promise<boolean> {
  if (!hasEbay || !result?.identified || !result.estimatedValue) return false;
  const ep = await ebayPrice(cardQuery(result), settings?.region);
  if (!ep) return false;
  result.estimatedValue = {
    low: Math.round(ep.low),
    mid: Math.round(ep.mid),
    high: Math.round(ep.high),
    currency: ep.currency,
    note: `Based on ${ep.count} current eBay listings (${ep.currency}). Asking prices — actual sold prices run a bit lower.`,
  };
  return true;
}

// Match a Pokémon scan against the official catalog (pokemontcg.io): correct its
// identity (set, number, rarity) to the real card AND apply real market price.
async function applyPokemonPrice(result: ScanResultShape) {
  if (!result?.identified || !isPokemon(result)) return;
  const m = await pokemonLookup(result.player || "", result.pokemon?.setNumber || result.cardNumber);
  if (!m) return;
  // Correct identity to the catalog's canonical card (more accurate than a read).
  if (m.name) result.player = m.name;
  if (m.setName) result.setName = m.setName;
  if (m.number) {
    result.cardNumber = m.number;
    result.pokemon = { ...(result.pokemon || {}), setNumber: m.number };
  }
  if (m.rarity) result.pokemon = { ...(result.pokemon || {}), rarity: m.rarity };
  // Apply the real market price when available.
  if (m.price && result.estimatedValue) {
    const cp = m.price;
    const r2 = (n: number) => (n >= 20 ? Math.round(n) : Math.round(n * 100) / 100);
    result.estimatedValue = {
      low: r2(cp.low),
      mid: r2(cp.mid),
      high: r2(cp.high),
      currency: cp.currency,
      note: `Based on current ${cp.source} market prices for this card (raw/ungraded).`,
    };
  }
}

// --- Bulk scan: identify EVERY card in a photo (a stack/spread/binder page) --
app.post("/api/bulk", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const body = req.body as {
    images?: { imageBase64: string; mediaType: string }[];
    imageBase64?: string;
    mediaType?: string;
    settings?: Settings;
  };
  const settings = body.settings;
  const images =
    body.images && body.images.length > 0
      ? body.images
      : body.imageBase64 && body.mediaType
      ? [{ imageBase64: body.imageBase64, mediaType: body.mediaType }]
      : [];

  if (images.length === 0) {
    res.status(400).json({ error: "Add at least one photo." });
    return;
  }
  const bad = images.find((im) => !ALLOWED_MEDIA.has(im.mediaType));
  if (bad) {
    res.status(400).json({ error: `Unsupported image type: ${bad.mediaType}` });
    return;
  }

  const sys = bulkSystemPrompt(settings || {});
  const parts: Part[] = [
    ...images.map((im) => ({ inlineData: { mimeType: im.mediaType, data: im.imageBase64 } })),
    {
      text:
        "Identify EVERY distinct trading card visible in the image(s). Return one entry per card " +
        "with its identity and a value range. Include unreadable cards with identified=false.",
    },
  ];

  try {
    const out = await analyze<{ cards: ScanResultShape[] }>(sys, parts, bulkSchema, groundedFor(settings));
    // eBay-first: real eBay prices for each identified card, with the free
    // Pokémon catalog as the fallback when eBay has nothing (or isn't configured).
    if (Array.isArray(out.cards)) {
      await Promise.all(
        out.cards.map(async (c) => {
          const applied = await applyEbayPrice(c, settings).catch(() => false);
          if (!applied) await applyPokemonPrice(c).catch(() => {});
        })
      );
    }
    res.json(out);
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// A card on one side of a trade: a text description and/or a photo.
interface CardEntry {
  text?: string;
  imageBase64?: string;
  mediaType?: string;
}

function entryHasContent(e: CardEntry): boolean {
  return Boolean(e.text?.trim() || (e.imageBase64 && e.mediaType));
}

/** Turn a side's card entries into Gemini content parts under a heading. */
function sideToParts(heading: string, entries: CardEntry[]): Part[] {
  const parts: Part[] = [{ text: `\n${heading}:` }];
  if (entries.length === 0) {
    parts.push({ text: "(none specified)" });
    return parts;
  }
  entries.forEach((e, i) => {
    parts.push({ text: `Card ${i + 1}:${e.text?.trim() ? " " + e.text.trim() : " (see photo)"}` });
    if (e.imageBase64 && e.mediaType && ALLOWED_MEDIA.has(e.mediaType)) {
      parts.push({ inlineData: { mimeType: e.mediaType, data: e.imageBase64 } });
    }
  });
  return parts;
}

interface TradeSideShape { valueLow?: number; valueHigh?: number; notes?: string }
interface TradeShape {
  fairness?: string;
  verdict?: string;
  yourSide?: TradeSideShape;
  theirSide?: TradeSideShape;
  valueGapNote?: string;
  reasoning?: string;
  suggestions?: string[];
}

const sideMid = (side?: TradeSideShape): number => {
  const lo = Number(side?.valueLow), hi = Number(side?.valueHigh);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  if (Number.isFinite(hi)) return hi;
  if (Number.isFinite(lo)) return lo;
  return NaN;
};

// The model used to return the directionless verdict "lopsided" far too often,
// and the UI could only render it as a red pill regardless of who came out
// ahead — so a fair-sounding explanation would sit under a scary "Lopsided"
// label. We no longer accept "lopsided": resolve any non-directional or invalid
// verdict to fair / favors_you / favors_them from the actual per-side values.
// (favors_you = the cards RECEIVED are worth more than the cards GIVEN UP.)
function normalizeFairness(t: TradeShape): TradeShape {
  if (t.fairness === "fair" || t.fairness === "favors_you" || t.fairness === "favors_them") return t;
  const you = sideMid(t.yourSide), them = sideMid(t.theirSide);
  if (Number.isFinite(you) && Number.isFinite(them) && (you > 0 || them > 0)) {
    const hi = Math.max(you, them), lo = Math.min(you, them);
    const gap = hi > 0 ? (hi - lo) / hi : 0;
    t.fairness = gap <= 0.2 ? "fair" : them > you ? "favors_you" : "favors_them";
  } else {
    t.fairness = "fair";
  }
  return t;
}

// --- Evaluate a trade, or suggest what to ask for --------------------------
app.post("/api/trade", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const { mode, yourSide, theirSide, owned, settings } = req.body as {
    mode?: "fairness" | "suggest" | "offer";
    yourSide?: CardEntry[];
    theirSide?: CardEntry[];
    owned?: string[];
    settings?: Settings;
  };

  const giving = (yourSide || []).filter(entryHasContent);
  const receiving = (theirSide || []).filter(entryHasContent);
  const myCards = (owned || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);

  try {
    // "Who should I give?" — you name a card you WANT, it suggests what to give.
    if (mode === "offer") {
      if (receiving.length === 0) {
        res.status(400).json({ error: "Add the card you want to receive." });
        return;
      }
      const sys = offerSystemPrompt(settings || {});
      const priceLines = await ebayPricesFor(receiving, settings);
      const parts: Part[] = [
        {
          text:
            "I want to ACQUIRE the following card(s). Suggest 2-4 distinct, fair packages of cards I could GIVE to get it." +
            (priceLines.length ? `\n\nReal eBay value of what I want:\n- ${priceLines.join("\n- ")}` : ""),
        },
        ...sideToParts("Card(s) I want to receive", receiving),
        ...(myCards.length ? [{ text: `Cards I own (strongly prefer suggesting from these):\n- ${myCards.join("\n- ")}` }] : []),
      ];
      res.json(await analyze(sys, parts, askSchema, groundedFor(settings)));
      return;
    }

    if (giving.length === 0) {
      res.status(400).json({ error: "Add at least one card you're giving up." });
      return;
    }

    if (mode === "suggest") {
      const sys = askSystemPrompt(settings || {});
      const priceLines = await ebayPricesFor(giving, settings);
      const parts: Part[] = [
        {
          text:
            "I want to trade away the following card(s). Tell me what I should ask for in return." +
            (priceLines.length ? `\n\nReal eBay value of what I'm giving:\n- ${priceLines.join("\n- ")}` : ""),
        },
        ...sideToParts("Cards I'm giving away", giving),
      ];
      res.json(await analyze(sys, parts, askSchema, groundedFor(settings)));
      return;
    }

    // Default: fairness check (needs both sides).
    if (receiving.length === 0) {
      res.status(400).json({ error: "Add at least one card on the other side, or use “What should I ask for?”." });
      return;
    }
    const sys = tradeSystemPrompt(settings || {});
    const priceLines = await ebayPricesFor([...giving, ...receiving], settings);
    const parts: Part[] = [
      {
        text:
          "Evaluate whether this trade is fair." +
          (priceLines.length
            ? `\n\nUSE THESE REAL eBay prices as the basis for each card's value — do NOT guess a price when a real one is given here:\n- ${priceLines.join("\n- ")}`
            : ""),
      },
      ...sideToParts("Cards I give up (my side)", giving),
      ...sideToParts("Cards I receive (their side)", receiving),
    ];
    res.json(normalizeFairness(await analyze<TradeShape>(sys, parts, tradeSchema, groundedFor(settings))));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// Look up real eBay prices for each text-described card entry, for anchoring.
async function ebayPricesFor(entries: CardEntry[], settings?: Settings): Promise<string[]> {
  if (!hasEbay) return [];
  const texts = entries.map((e) => e.text?.trim()).filter((x): x is string => !!x);
  const results = await Promise.all(
    texts.map(async (q) => {
      const ep = await ebayPrice(q, settings?.region);
      return ep ? `"${q}" ≈ ${ep.currency} ${ep.mid} (range ${ep.low}–${ep.high}, from ${ep.count} eBay listings)` : null;
    })
  );
  return results.filter((x): x is string => !!x);
}

// --- Trade-up path: chain of fair trades from owned cards to a target -------
app.post("/api/tradeup", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { target, owned, settings } = req.body as {
    target?: string;
    owned?: string[];
    settings?: Settings;
  };
  const goal = (target || "").trim();
  const have = (owned || []).map((s) => String(s).trim()).filter(Boolean);
  if (!goal) {
    res.status(400).json({ error: "Name the target card you want to trade up to." });
    return;
  }
  if (have.length === 0) {
    res.status(400).json({ error: "Add cards to your binder first — the path starts from what you own." });
    return;
  }
  const sys = tradeUpSystemPrompt(settings || {});
  const targetPrice = hasEbay ? await ebayPrice(goal, settings?.region) : null;
  const parts: Part[] = [
    {
      text:
        `TARGET (grail) the collector wants: ${goal}\n` +
        (targetPrice ? `Real eBay value of the target: ${targetPrice.currency} ${targetPrice.mid} (${targetPrice.low}–${targetPrice.high}).\n` : "") +
        `\nCards they OWN to start from:\n- ${have.slice(0, 60).join("\n- ")}\n\n` +
        `Plan a realistic, fair trade-up path from these cards to the target.`,
    },
  ];
  try {
    res.json(await analyze(sys, parts, tradeUpSchema, groundedFor(settings)));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Morning digest: generated ONCE on the server per day, cached & shared --
// Bump to regenerate every cached briefing after a logic change.
const DIGEST_GEN_VERSION = "7";
// The shared briefing always covers all supported sports; each user's view is
// filtered to the sports they follow. That lets one generation serve everyone.
const ALL_DIGEST_SPORTS = ["Baseball", "Basketball", "Football", "Soccer", "Hockey", "Cricket", "Pokémon"];

type DigestSection = { sport: string; risingStars: string[]; declining: string[]; storylines: string[]; trades: string[]; chase: string[]; news: string[] };
type Briefing = { overview: string; yourCards: string[]; yourWishlist: string[]; sections: DigestSection[] };

const factsToSections = (data: { sport: string; lines: string[] }[]): DigestSection[] =>
  data
    .map((f) => ({
      sport: f.sport, risingStars: [], declining: [],
      storylines: f.lines.filter((l) => !/:\s*$/.test(l)).slice(0, 10),
      trades: [], chase: [], news: [],
    }))
    .filter((s) => s.storylines.length);
const briefingHasContent = (b: Briefing) =>
  b.sections.some((s) => s.risingStars.length || s.declining.length || s.storylines.length || s.trades.length || s.chase.length || s.news.length);

// Build a real one-line headline from the verified-feed fallback, instead of the
// old generic "scores and standout performances across X, Y". Leads with the
// single most notable line (a standout stat line or a result) and tallies the
// rest, so the overview actually reflects the body even when the AI writer was
// unavailable and we're serving raw verified data.
function fallbackOverview(sections: DigestSection[]): string {
  const clean = (l: string) => l.replace(/^[\s•\-–—]+/, "").trim();
  const sportNames = [...new Set(sections.map((s) => s.sport.replace(/\s*\(.*\)/, "")))];
  const all = sections.flatMap((s) => s.storylines.map(clean)).filter(Boolean);
  if (!all.length) return `Yesterday's results across ${sportNames.join(", ")}.`;
  // A real sports result/performance makes a stronger headline than an online
  // Pokémon tournament, so lead with one when available; only fall back to a
  // Pokémon line (or any line) if that's all there is.
  const sportsLines = sections
    .filter((s) => !/pok[eé]mon/i.test(s.sport))
    .flatMap((s) => s.storylines.map(clean))
    .filter(Boolean);
  const notable = /\bHR\b|\bRBI\b|\d+\s*K\b|goals?|no-hitter|walk-?off|\(final\)/i;
  const lead =
    sportsLines.find((l) => notable.test(l)) ||
    sportsLines[0] ||
    all.find((l) => /won by/i.test(l)) ||
    all[0];
  const more = all.length - 1;
  const tail = more > 0
    ? ` — plus ${more} more result${more === 1 ? "" : "s"} across ${sportNames.join(", ")}`
    : "";
  return `${lead}${tail}.`;
}

// Generate one day's shared briefing. NEVER throws — on total failure it returns
// a verified-feed fallback or a quiet-day briefing, so the app is never blank.
async function buildDigest(target: string): Promise<Briefing> {
  const yesterday = addDaysISO(target, -1);
  const windowStart = yesterday < LAUNCH_DATE ? LAUNCH_DATE : yesterday;
  const cats = ALL_DIGEST_SPORTS;
  const sys = digestSystemPrompt({}, cats);
  const verifiedData = await verifiedSportsFactsData(cats, windowStart).catch(() => []);
  const verified = verifiedData.length
    ? verifiedData.map((f) => `${f.sport} — VERIFIED results for ${windowStart}:\n${f.lines.join("\n")}`).join("\n\n")
    : "";
  const quiet = (): Briefing => ({ overview: "A quiet day across the hobby — nothing major to report.", yourCards: [], yourWishlist: [], sections: [] });
  const fallback = (): Briefing | null => {
    const s = factsToSections(verifiedData);
    if (!s.length) return null;
    return { overview: fallbackOverview(s), yourCards: [], yourWishlist: [], sections: s };
  };
  const parts: Part[] = [
    {
      text:
        `The real-world date right now is ${today()}. You are writing the MORNING briefing for ${target}.\n` +
        `A morning briefing reports what happened THE DAY BEFORE — i.e. yesterday, which is ${windowStart}. So cover events from ${windowStart} (plus anything overnight into the early morning of ${target}). Think of ${windowStart} as "yesterday".\n\n` +
        `DATE RULES (the last briefing got these badly wrong — fix it):\n` +
        `• Include an item ONLY if it genuinely happened on ${windowStart} or overnight into ${target}. Anything from an earlier day is OUT, even if it's still being discussed or trending.\n` +
        `• Do NOT take an older event and stamp it with a date in this window. Every item must have actually occurred in the window, on the date its source reports. Never relabel ${LAUNCH_DATE} (or any other day) onto things that happened later or earlier.\n` +
        `• Nothing before ${LAUNCH_DATE}; nothing after ${target}.\n\n` +
        `ANTI-HALLUCINATION (critical — the last briefing invented a fake "Aaron Judge hit his 11th homer vs the Reds"): only state a specific fact — a score, a stat line, a home-run/point total, an "Nth of the season", an injury, a transaction, an opponent, a date — if live Google Search results EXPLICITLY confirm it for this window. If you cannot verify the specifics from search, DROP the item entirely. Do not guess numbers, opponents, or dates. A wrong specific is far worse than an omission. When unsure, leave it out.\n` +
        `This applies to UNVERIFIED, search-only claims. The VERIFIED RESULTS block below (when present) is already confirmed and correctly dated — you MUST use it. Only drop UNVERIFIED extras you can't confirm; never drop or ignore the verified results.\n` +
        `RELIABILITY: do NOT return an all-empty briefing when the VERIFIED RESULTS block below contains any games — those are real, so always turn the notable ones into storylines and risingStars. A blank briefing is only acceptable when there is genuinely no verified data AND nothing confirmable from search for ${windowStart}. Aim to always give the reader a real briefing built from the verified results.\n\n` +
        `Among VERIFIED events only, lead with the biggest: top performances (multi-homer games, 40-point nights, no-hitters, hat tricks, walk-offs), milestones, and marquee results. Skip minor transactions, independent/minor leagues, and routine IL moves.\n\n` +
        `MANDATORY FORMAT — every single item in every array (and every bucket) MUST begin with the event's real date in square brackets, e.g. "[${windowStart}] Aaron Judge homered twice as the Yankees beat the Reds." The date is the day the event actually happened, taken from your search results — not a guess. Items are MACHINE-FILTERED after you respond: anything dated outside ${windowStart} to ${target} is automatically DELETED.\n` +
        `Do NOT write any calendar date inside the sentence itself (no "on June 19", no "6/19") — the leading [date] tag is the ONLY place a date goes. An item whose sentence mentions a day outside ${windowStart}–${target} is also deleted, so never reference an out-of-window day.\n\n` +
        `HEADLINE MUST MATCH THE BODY: the "overview" is a one-line summary of the items below it. Every result, score, game, or story you name in the overview MUST ALSO appear as an item in the matching bucket. If there are no items for any bucket, the overview MUST plainly say it was a quiet day, NOT a dramatic headline. The overview and the sections can never contradict each other.\n\n` +
        (verified
          ? `=== VERIFIED RESULTS (authoritative — pulled directly from official league data for ${windowStart}) ===\n${verified}\n\n` +
            `For the sports covered by this VERIFIED block, build "risingStars" and "storylines" ONLY from these real results — these scores and stat lines are correct and correctly dated. Do NOT add, invent, search for, or "remember" any other games for those sports. Pick the most notable lines, write each as one vivid sentence, and tag it [${windowStart}]. You may still use search for those sports' "trades" and "news" and for any sport NOT in the verified block.\n\n`
          : "") +
        `=== POKÉMON TCG ===\nThere's no pre-verified feed for Pokémon, so research it with Google Search: find Pokémon TCG tournaments that CONCLUDED on ${windowStart} (Regionals, Special Events, Worlds, major online events) via Limitless TCG and RK9, report winners and winning decks plus meta shifts, in the Pokémon section. Only report what search confirms, date-tagged [${windowStart}]; never invent a tournament or deck.\n\n` +
        `Write the briefing for ${target} (covering ${windowStart}), for these categories: ${cats.join(", ")}.`,
    },
  ];
  try {
    const result = await analyze<DigestShape>(sys, parts, digestSchema, groundedFor({}));
    const sections: DigestSection[] = (result.sections || []).map((s) => ({
      sport: s.sport,
      risingStars: keepInWindow(s.risingStars, windowStart, target),
      declining: keepInWindow(s.declining, windowStart, target),
      storylines: keepInWindow(s.storylines, windowStart, target),
      trades: keepInWindow(s.trades, windowStart, target),
      chase: keepInWindow(s.chase, windowStart, target),
      news: keepInWindow(s.news, windowStart, target),
    }));
    const briefing: Briefing = { overview: result.overview, yourCards: [], yourWishlist: [], sections };
    if (briefingHasContent(briefing)) return briefing;
    // Model returned nothing — fall back to the verified feeds, else quiet day.
    return fallback() || quiet();
  } catch {
    return fallback() || quiet();
  }
}

// Shared cache: memory (fast) + Postgres (survives restarts). One generation per
// day serves every user. We only persist briefings that actually have content,
// so a transient empty result isn't locked in.
const digestMem = new Map<string, Briefing>();
const digestInflight = new Map<string, Promise<Briefing>>();
async function getDailyDigest(target: string): Promise<Briefing> {
  const key = `${DIGEST_GEN_VERSION}:${target}`;
  const hit = digestMem.get(key);
  if (hit) return hit;
  const fromDb = (await cloud.loadDigest(key).catch(() => null)) as Briefing | null;
  if (fromDb && Array.isArray(fromDb.sections)) { digestMem.set(key, fromDb); return fromDb; }
  const running = digestInflight.get(key);
  if (running) return running;
  const p = (async () => {
    const d = await buildDigest(target);
    if (briefingHasContent(d)) {
      digestMem.set(key, d);
      await cloud.saveDigest(key, d).catch(() => {});
    }
    return d;
  })().finally(() => digestInflight.delete(key));
  digestInflight.set(key, p);
  return p;
}

// Keep TODAY's briefing warm so it's ready the instant anyone opens the app —
// and gets generated even with no visitors (as long as the server is awake).
function startDigestScheduler() {
  if (!hasApiKey) return;
  const tick = () => { getDailyDigest(today()).catch(() => {}); };
  setTimeout(tick, 5000); // shortly after boot
  setInterval(tick, 30 * 60 * 1000); // and every 30 minutes
}

const normSport = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Daily generation trigger for an external scheduler (e.g. a Render Cron Job),
// so today's briefing is built on a fixed schedule even when nobody has opened
// the app — and even if the web instance was asleep, since the incoming request
// wakes it. Idempotent: getDailyDigest caches + persists, so repeat calls are
// cheap no-ops once today's briefing exists.
app.get("/api/cron/digest", async (_req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  try {
    const b = await getDailyDigest(today());
    res.json({ ok: true, date: today(), sections: b.sections.length });
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

app.post("/api/digest", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { date, sports } = req.body as { date?: string; sports?: string[] };
  const cats = (sports || []).map((s) => String(s).trim()).filter(Boolean);
  if (cats.length === 0) {
    res.status(400).json({ error: "Enable at least one category for the morning update." });
    return;
  }
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? (date as string) : today();
  const target = reqDate > today() ? today() : reqDate < LAUNCH_DATE ? LAUNCH_DATE : reqDate;
  try {
    const shared = await getDailyDigest(target);
    // Show only the sports this user follows.
    const keys = cats.map((c) => normSport(c).split(/[\s/(]/)[0]).filter(Boolean);
    const sections = shared.sections.filter((s) => keys.some((k) => normSport(s.sport).includes(k)));
    res.json({ overview: shared.overview, yourCards: [], yourWishlist: [], sections });
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Set completion: base-set size + notable missing cards -----------------
app.post("/api/checklist", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { set, ownedNumbers, settings } = req.body as {
    set?: { year?: string; manufacturer?: string; setName?: string; sport?: string };
    ownedNumbers?: string[];
    settings?: Settings;
  };
  const label = [set?.year, set?.manufacturer, set?.setName].filter(Boolean).join(" ").trim();
  if (!label) {
    res.status(400).json({ error: "A set (year/manufacturer/name) is required." });
    return;
  }
  const owned = (ownedNumbers || []).map((n) => String(n).trim()).filter(Boolean).slice(0, 400);
  const sys = checklistSystemPrompt(settings || {});
  const parts: Part[] = [
    {
      text:
        `Set to complete: ${label}${set?.sport ? ` (${set.sport})` : ""}.\n` +
        `Today's date is ${today()} — use it to judge how complete/old the set is.\n` +
        (owned.length
          ? `The collector already OWNS these card numbers from this set:\n${owned.join(", ")}\n\n`
          : `The collector hasn't logged specific card numbers yet.\n\n`) +
        `Report the base-set size and the notable BASE cards they're still MISSING (exclude the owned numbers above).`,
    },
  ];
  try {
    res.json(await analyze(sys, parts, checklistSchema, groundedFor(settings)));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Streaming chat (with live grounding) ----------------------------------
app.post("/api/chat", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const { messages, settings, cardContext } = req.body as {
    messages?: { role: "user" | "assistant"; content: string }[];
    settings?: Settings;
    cardContext?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages is required." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const systemInstruction =
    chatSystemPrompt(settings || {}, cardContext) +
    `\n\nToday's date is ${today()}. When a question depends on current form, news, or prices, use Google Search rather than memory.`;

  const openStream = (model: string, grounded: boolean) =>
    ai.models.generateContentStream({
      model,
      contents,
      config: {
        maxOutputTokens: MAX_OUTPUT,
        thinkingConfig: NO_THINKING,
        systemInstruction,
        ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

  // Open a stream, preferring grounding + the best model, with the same
  // fallbacks as analyze(): drop grounding on a non-429 failure, move to the
  // next (higher-quota) model on a rate limit.
  const grounded = groundedFor(settings);
  async function openWithFallback() {
    let lastErr: unknown;
    for (const model of MODELS) {
      try {
        if (!grounded) return await openStream(model, false);
        try {
          return await openStream(model, true);
        } catch (err) {
          if (isRateLimit(err)) throw err;
          return await openStream(model, false);
        }
      } catch (err) {
        lastErr = err;
        if (isRateLimit(err)) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  try {
    const stream = await openWithFallback();

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) send("delta", { text });
    }
    send("done", {});
    res.end();
  } catch (err) {
    const { message } = describeError(err);
    send("error", { message });
    res.end();
  }
});

// --- Translate UI strings (full-app localization) --------------------------
app.post("/api/translate", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { texts, language } = req.body as { texts?: string[]; language?: string };
  if (!Array.isArray(texts) || texts.length === 0 || !language) {
    res.status(400).json({ error: "texts and language are required." });
    return;
  }
  if (language.toLowerCase() === "english") {
    res.json({ translations: Object.fromEntries(texts.map((t) => [t, t])) });
    return;
  }
  try {
    const prompt =
      `Translate these UI strings for a trading-card collector app into ${language}. ` +
      `Return ONLY a JSON object that maps each ORIGINAL English string (exact key) to its ${language} translation. ` +
      `These are buttons, tabs, and labels, so make them SHORT, natural, and idiomatic — prefer the common everyday term and the shortest accurate wording (avoid long compound phrasings); use the standard term a native speaker would see in an app. ` +
      `Keep emojis, numbers, currency, punctuation, and placeholders like "(3)" or "/150" intact, and preserve any leading/trailing spaces. ` +
      `Do not add keys that aren't in the list.\n\nStrings:\n${JSON.stringify(texts)}`;
    // Use flash-lite (higher free quota) so translation doesn't compete with scans.
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: { temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: NO_THINKING, responseMimeType: "application/json" },
    });
    res.json({ translations: parseJson(response.text) });
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Welcome email on sign-up ----------------------------------------------
// Sends a fixed welcome email. Two ways to configure it (Gmail is checked
// first): Gmail SMTP via GMAIL_USER + GMAIL_APP_PASSWORD (free, no domain), or
// Resend via RESEND_API_KEY (+ EMAIL_FROM). The endpoint only ever sends a
// fixed template to the address given, so it can't send arbitrary content.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Card-O-Rama <onboarding@resend.dev>";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
// Outlook/Hotmail shortcut — same convenience as Gmail (no host to remember).
const OUTLOOK_USER = process.env.OUTLOOK_USER || "";
const OUTLOOK_APP_PASSWORD = (process.env.OUTLOOK_APP_PASSWORD || "").replace(/\s+/g, "");
// Brevo (Sendinblue) over its HTTPS API — the reliable choice on hosts that
// BLOCK outbound SMTP ports (Render, Vercel, etc.), since it goes over 443.
// Free 300/day, emails ANYONE, no domain: just verify a single sender address.
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BREVO_FROM = process.env.BREVO_FROM || (GMAIL_USER ? `Card-O-Rama <${GMAIL_USER}>` : "");
// Generic SMTP — use ANY provider that sends to any recipient (Gmail, Brevo,
// SendGrid, Outlook, your own server). No domain needed if the provider allows
// a verified single sender. Takes priority when SMTP_HOST is set.
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true"; // true for port 465
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `Card-O-Rama <${SMTP_USER}>` : "");
const hasSmtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Which email provider is live, and whether it can reach ANY recipient (vs.
// Resend's sandbox, which only emails your own address). Shared by /api/health
// and the startup log so delivery problems are self-diagnosable.
function emailStatus(): { provider: string; anyRecipient: boolean; note: string } {
  if (BREVO_API_KEY && BREVO_FROM) return { provider: "brevo", anyRecipient: true, note: "Brevo HTTPS API (works where SMTP is blocked)" };
  if (hasSmtp) return { provider: "smtp", anyRecipient: true, note: `SMTP (${SMTP_HOST}) — needs outbound SMTP unblocked` };
  if (GMAIL_USER && GMAIL_APP_PASSWORD) return { provider: "gmail", anyRecipient: true, note: `Gmail (${GMAIL_USER}) — fails if the host blocks outbound SMTP; use Brevo instead` };
  if (OUTLOOK_USER && OUTLOOK_APP_PASSWORD) return { provider: "outlook", anyRecipient: true, note: `Outlook (${OUTLOOK_USER}) — fails if the host blocks outbound SMTP; use Brevo instead` };
  if (RESEND_API_KEY) {
    const verified = !/resend\.dev/i.test(EMAIL_FROM); // own domain in EMAIL_FROM ⇒ verified
    return {
      provider: "resend",
      anyRecipient: verified,
      note: verified ? "Resend (verified domain)" : "Resend SANDBOX — only emails your own address; new users get nothing. Use Gmail/Outlook/SMTP or verify a domain.",
    };
  }
  return { provider: "none", anyRecipient: false, note: "No email provider configured." };
}
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function welcomeHtml(name: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a2030">` +
    `<h2 style="margin:0 0 8px">Welcome to Card-O-Rama, ${name}! 🎴</h2>` +
    `<p>Your account is all set. Scan a card to get its value, hidden stats, a condition read, and smart trade ideas — across Pokémon, baseball, soccer, cricket, basketball, football, and hockey.</p>` +
    `<p>Build your binder, track a wishlist, check if a trade is fair, and rack up achievements as your collection grows.</p>` +
    `<p style="color:#5c6884">Happy collecting! 🃏</p>` +
    `</div>`
  );
}

interface SendResult { ok: boolean; via?: string; reason?: string; error?: string; status?: number }

// Shared email sender: Gmail SMTP first (free, any recipient), then Resend
// (needs a verified domain to email anyone). Used by welcome + reset emails.
// Load nodemailer lazily with a clear message if it isn't installed.
async function loadNodemailer() {
  try {
    return (await import("nodemailer")).default;
  } catch {
    throw new Error("nodemailer isn't installed — run `npm install` in the project root (or `cd server && npm install`) and restart the server.");
  }
}

async function sendEmail(to: string, subject: string, html: string, tag: string): Promise<SendResult> {
  // Fail fast instead of hanging: an unreachable/slow SMTP host (Outlook is a
  // frequent offender) would otherwise block the request for the OS socket
  // timeout — that's the "email takes forever" symptom.
  const timeouts = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };
  // Gmail/Outlook app passwords are shown WITH spaces ("abcd efgh ijkl mnop").
  // Pasted verbatim they fail auth with a 535 — strip whitespace so they work.
  const gmailPass = GMAIL_APP_PASSWORD.replace(/\s+/g, "");
  const outlookPass = OUTLOOK_APP_PASSWORD.replace(/\s+/g, "");

  // Try every configured provider in priority order. Crucially, if one is
  // configured but FAILS (bad password, host down), fall through to the next
  // instead of giving up — a broken leftover SMTP/Resend shouldn't block Gmail.
  // Parse a "Name <email>" (or bare "email") sender string.
  const parseFrom = (s: string): { name: string; email: string } => {
    const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1] || "Card-O-Rama", email: m[2].trim() };
    return { name: "Card-O-Rama", email: s.trim() };
  };

  const attempts: { name: string; run: () => Promise<SendResult> }[] = [];
  // Brevo first: HTTPS (port 443), so it works even where outbound SMTP is
  // blocked — the "test email loaded forever then nothing" symptom.
  if (BREVO_API_KEY && BREVO_FROM) attempts.push({ name: "brevo", run: async () => {
    const sender = parseFrom(BREVO_FROM);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (r.ok) return { ok: true, via: "brevo" };
    const text = await r.text().catch(() => "");
    const hint = /sender|not.*valid|unrecognized/i.test(text)
      ? ` Verify the sender address "${sender.email}" in Brevo (Senders & IP) and set BREVO_FROM to it.`
      : "";
    throw new Error(`Brevo ${r.status}: ${text.slice(0, 160)}${hint}`);
  }});
  if (hasSmtp) attempts.push({ name: "smtp", run: async () => {
    const nodemailer = await loadNodemailer();
    const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS }, ...timeouts });
    await t.sendMail({ from: SMTP_FROM, to, subject, html });
    return { ok: true, via: "smtp" };
  }});
  if (GMAIL_USER && gmailPass) attempts.push({ name: "gmail", run: async () => {
    const nodemailer = await loadNodemailer();
    const t = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: gmailPass }, ...timeouts });
    await t.sendMail({ from: `Card-O-Rama <${GMAIL_USER}>`, to, subject, html });
    return { ok: true, via: "gmail" };
  }});
  if (OUTLOOK_USER && outlookPass) attempts.push({ name: "outlook", run: async () => {
    const nodemailer = await loadNodemailer();
    const t = nodemailer.createTransport({ host: "smtp-mail.outlook.com", port: 587, secure: false, auth: { user: OUTLOOK_USER, pass: outlookPass }, ...timeouts });
    await t.sendMail({ from: `Card-O-Rama <${OUTLOOK_USER}>`, to, subject, html });
    return { ok: true, via: "outlook" };
  }});
  if (RESEND_API_KEY) attempts.push({ name: "resend", run: async () => {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });
    if (r.ok) return { ok: true, via: "resend" };
    const text = await r.text().catch(() => "");
    const hint = r.status === 403 || /domain|verif|testing|own email/i.test(text)
      ? " Resend only emails arbitrary addresses once you've verified a domain; otherwise it sends only to your own Resend account email. Use Gmail/Outlook/SMTP to email anyone."
      : "";
    throw new Error(`Resend ${r.status}: ${text.slice(0, 160)}${hint}`);
  }});

  if (!attempts.length) {
    console.warn(`[${tag}] No email provider configured (set GMAIL_USER+GMAIL_APP_PASSWORD, OUTLOOK_*, SMTP_*, or RESEND_API_KEY).`);
    return { ok: false, reason: "email-not-configured", error: "No email provider is configured on the server." };
  }

  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const r = await a.run();
      if (errors.length) console.warn(`[${tag}] sent via ${a.name} after earlier failures: ${errors.join(" | ")}`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[${tag}] ${a.name} failed: ${msg}`);
      errors.push(`${a.name}: ${msg}`);
    }
  }
  return { ok: false, status: 502, error: `Email send failed. ${errors.join(" | ")}` };
}

function resetHtml(name: string, code: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a2030">` +
    `<h2 style="margin:0 0 8px">Password reset 🔑</h2>` +
    `<p>Hi ${name}, here's your Card-O-Rama password reset code:</p>` +
    `<p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:14px 0">${escapeHtml(code)}</p>` +
    `<p style="color:#5c6884">Enter it in the app to set a new password. It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>` +
    `</div>`
  );
}

app.post("/api/notify", async (req: Request, res: Response) => {
  const { email, username } = req.body as { email?: string; username?: string };
  const to = (email || "").trim();
  if (!emailOk(to)) {
    res.status(400).json({ ok: false, error: "Invalid email." });
    return;
  }
  const name = escapeHtml((username || "there").toString().slice(0, 60));
  const result = await sendEmail(to, "Welcome to Card-O-Rama 🎴", welcomeHtml(name), "notify");
  res.status(result.ok ? 200 : result.status || 200).json(result);
});

// Reset code email. The reset itself happens client-side (accounts are
// device-local); the server only relays a one-time code to the address.
app.post("/api/reset-code", async (req: Request, res: Response) => {
  const { email, username, code } = req.body as { email?: string; username?: string; code?: string };
  const to = (email || "").trim();
  const safeCode = (code || "").toString().trim();
  if (!emailOk(to)) {
    res.status(400).json({ ok: false, error: "Invalid email." });
    return;
  }
  if (!/^\d{4,8}$/.test(safeCode)) {
    res.status(400).json({ ok: false, error: "Invalid code." });
    return;
  }
  const name = escapeHtml((username || "there").toString().slice(0, 60));
  const result = await sendEmail(to, "Your Card-O-Rama reset code", resetHtml(name, safeCode), "reset");
  res.status(result.ok ? 200 : result.status || 200).json(result);
});

// --- Cloud accounts + cross-device sync (only when DATABASE_URL is set) -----
function cloudGuard(res: Response): boolean {
  if (!cloud.hasCloud) {
    res.status(503).json({ error: "Cloud sync isn't configured on the server." });
    return false;
  }
  return true;
}
const bearer = (req: Request) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
function cloudFail(res: Response, err: unknown) {
  if (err instanceof cloud.CloudError) res.status(err.status).json({ error: err.message });
  else {
    console.warn(`[cloud] ${err instanceof Error ? err.message : err}`);
    res.status(500).json({ error: "Cloud sync error. Try again." });
  }
}

// One-shot admin wipe of ALL accounts + synced data, for a clean restart.
// Disabled unless ADMIN_RESET_TOKEN is set; requires that token plus an
// explicit confirm=yes so a stray request can't trigger it. Visit:
//   /api/admin/reset?token=YOUR_TOKEN&confirm=yes
app.get("/api/admin/reset", async (req: Request, res: Response) => {
  const token = process.env.ADMIN_RESET_TOKEN || "";
  if (!token) { res.status(404).json({ error: "Reset is disabled (set ADMIN_RESET_TOKEN to enable)." }); return; }
  if (req.query.token !== token) { res.status(403).json({ error: "Wrong or missing token." }); return; }
  if (req.query.confirm !== "yes") {
    res.status(400).json({ error: "Add &confirm=yes to actually wipe every account. This cannot be undone." });
    return;
  }
  if (!cloud.hasCloud) {
    res.json({ ok: true, wiped: 0, note: "Cloud sync isn't configured, so there are no server accounts to delete. Device-local accounts only exist in each browser." });
    return;
  }
  try {
    const wiped = await cloud.wipeAllAccounts();
    console.warn(`[admin] wiped ${wiped} account(s) via /api/admin/reset`);
    res.json({ ok: true, wiped });
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/register", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  const { username, email, password } = req.body as { username?: string; email?: string; password?: string };
  try {
    const auth = await cloud.register(username || "", email || "", password || "");
    res.json(auth);
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/login", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  const { username, password } = req.body as { username?: string; password?: string };
  try {
    res.json(await cloud.login(username || "", password || ""));
  } catch (err) {
    cloudFail(res, err);
  }
});

// Verify a Google ID token (JWT) with Google and return the verified profile.
// Uses Google's tokeninfo endpoint so we don't need a crypto library. If
// GOOGLE_CLIENT_ID is set, we also check the token was issued for THIS app.
async function verifyGoogleToken(credential: string): Promise<{ email: string; name: string }> {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) throw new cloud.CloudError(401, "Google sign-in couldn't be verified.");
  const info = (await r.json()) as { aud?: string; email?: string; email_verified?: string | boolean; name?: string };
  const expectAud = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
  if (expectAud && info.aud !== expectAud) throw new cloud.CloudError(401, "This Google sign-in is for a different app.");
  if (!info.email || (info.email_verified !== true && info.email_verified !== "true")) {
    throw new cloud.CloudError(401, "Google didn't confirm a verified email.");
  }
  return { email: info.email, name: info.name || "" };
}

// Verify a Google OAuth ACCESS token (from the account-picker popup flow) and
// return the verified profile: confirm it was issued for this app (tokeninfo),
// then read the email/name from the userinfo endpoint.
async function verifyGoogleAccessToken(accessToken: string): Promise<{ email: string; name: string }> {
  const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!ti.ok) throw new cloud.CloudError(401, "Google sign-in couldn't be verified.");
  const tinfo = (await ti.json()) as { aud?: string; azp?: string };
  const expectAud = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
  if (expectAud && tinfo.aud !== expectAud && tinfo.azp !== expectAud) {
    throw new cloud.CloudError(401, "This Google sign-in is for a different app.");
  }
  const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ui.ok) throw new cloud.CloudError(401, "Couldn't read your Google profile.");
  const u = (await ui.json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!u.email || u.email_verified === false) throw new cloud.CloudError(401, "Google didn't confirm a verified email.");
  return { email: u.email, name: u.name || "" };
}

app.post("/api/cloud/google", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try {
    const body = req.body as { accessToken?: string; credential?: string };
    const profile = body.accessToken
      ? await verifyGoogleAccessToken(body.accessToken)
      : body.credential
      ? await verifyGoogleToken(body.credential)
      : null;
    if (!profile) { res.status(400).json({ error: "Missing Google sign-in token." }); return; }
    res.json(await cloud.googleAuth(profile.email, profile.name));
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/rename", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try {
    const userId = await cloud.userForToken(bearer(req));
    if (!userId) { res.status(401).json({ error: "Not signed in." }); return; }
    const display = await cloud.renameUser(userId, (req.body as { display?: string }).display || "");
    res.json({ ok: true, display });
  } catch (err) {
    cloudFail(res, err);
  }
});

app.get("/api/cloud/sync", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try {
    const userId = await cloud.userForToken(bearer(req));
    if (!userId) { res.status(401).json({ error: "Not signed in." }); return; }
    res.json(await cloud.getData(userId));
  } catch (err) {
    cloudFail(res, err);
  }
});

app.put("/api/cloud/sync", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try {
    const userId = await cloud.userForToken(bearer(req));
    if (!userId) { res.status(401).json({ error: "Not signed in." }); return; }
    const body = req.body as { data?: unknown; baseVersion?: number };
    const r = await cloud.putData(userId, body.data, body.baseVersion);
    if (r.conflict) {
      // Someone else wrote since the client last synced. Hand back the current
      // server copy + version so the client can merge and retry — never silently
      // overwrite a newer collection.
      res.status(409).json({ version: r.version, data: r.data });
      return;
    }
    res.json({ version: r.version });
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/logout", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try { await cloud.logout(bearer(req)); res.json({ ok: true }); } catch (err) { cloudFail(res, err); }
});

app.delete("/api/cloud/account", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  try {
    const userId = await cloud.userForToken(bearer(req));
    if (!userId) { res.status(401).json({ error: "Not signed in." }); return; }
    await cloud.deleteAccount(userId);
    res.json({ ok: true });
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/forgot", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  const email = ((req.body as { email?: string }).email || "").trim();
  if (!emailOk(email)) { res.status(400).json({ error: "Invalid email." }); return; }
  try {
    const rc = await cloud.createResetCode(email);
    // Always say ok (don't reveal whether an account exists), but only email if real.
    if (rc) await sendEmail(email, "Your Card-O-Rama reset code", resetHtml(escapeHtml(rc.display), rc.code), "cloud-reset");
    res.json({ ok: true });
  } catch (err) {
    cloudFail(res, err);
  }
});

app.post("/api/cloud/reset", async (req: Request, res: Response) => {
  if (!cloudGuard(res)) return;
  const { email, code, password } = req.body as { email?: string; code?: string; password?: string };
  try {
    await cloud.applyReset(email || "", code || "", password || "");
    res.json({ ok: true });
  } catch (err) {
    cloudFail(res, err);
  }
});

// In production, serve the built web app from the same origin as the API, so
// the whole thing deploys as ONE unit on ONE domain: no CORS, and the UI's
// relative /api calls just work. In dev the Vite server serves the UI instead,
// so this only kicks in once `web/dist` has been built.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const servingWeb = existsSync(join(webDist, "index.html"));
if (servingWeb) {
  // Client-side config (GA/Ads/AdSense ids) is normally baked into the JS bundle
  // at build time by Vite. That makes it fragile on hosts where build-time env
  // isn't wired up (e.g. a dashboard var that only exists at runtime), which
  // silently disables analytics — GA then shows 0 users forever. To make it
  // robust, we also inject these ids from the *runtime* environment into
  // index.html as window.__APP_CONFIG; the client prefers it when the build-time
  // value is empty. So setting GTAG_ID in the host dashboard is enough — no
  // rebuild required. Values accept the VITE_ names too, for a single source.
  const runtimeConfig = {
    gtagId: process.env.GTAG_ID || process.env.VITE_GTAG_ID || "",
    adsConversion: process.env.ADS_CONVERSION || process.env.VITE_ADS_CONVERSION || "",
    adsenseClient: process.env.ADSENSE_CLIENT || process.env.VITE_ADSENSE_CLIENT || "",
    adsenseSlot: process.env.ADSENSE_SLOT || process.env.VITE_ADSENSE_SLOT || "",
  };
  const rawIndex = readFileSync(join(webDist, "index.html"), "utf8");
  const configTag = `<script>window.__APP_CONFIG=${JSON.stringify(runtimeConfig).replace(
    /</g,
    "\\u003c",
  )}</script>`;
  const indexHtml = rawIndex.includes("</head>")
    ? rawIndex.replace("</head>", `${configTag}</head>`)
    : configTag + rawIndex;

  // Serve everything except index.html as static; we hand-serve index.html so it
  // carries the injected runtime config.
  app.use(express.static(webDist, { index: false }));
  // SPA fallback: any non-API GET returns the config-injected index.html.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.type("html").send(indexHtml);
  });
}

app.listen(PORT, () => {
  // On a host (e.g. Render) show the real public URL; locally show localhost.
  const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  console.log(`card-scanner API listening on ${publicUrl}`);
  console.log(`  provider: google-gemini  models: ${MODELS.join(" → ")}  grounding: ${USE_GROUNDING ? "on" : "off"}`);
  if (servingWeb) console.log(`  serving web app from ${webDist}`);
  console.log(`  eBay pricing: ${hasEbay ? "on" : "off (set EBAY_CLIENT_ID/SECRET for real prices)"}`);
  console.log(`  Pokémon prices: on (pokemontcg.io — free TCGplayer/Cardmarket market data, no key)`);
  console.log(`  reverse-image ID: ${hasVision ? "on (Google Vision web detection)" : "off (set GOOGLE_VISION_API_KEY to boost photo ID)"}`);
  console.log(`  price double-check: on (second sold-comp pass on every appraisal)`);
  console.log(`  digest sports data: MLB + NHL official, ESPN (NBA, NFL, soccer leagues, World Cup, March Madness…) & ESPNcricinfo (IPL + all cricket) — free, no key`);
  console.log(`  Pokémon TCG results: on — ${hasLimitless ? "Limitless API (exact)" : "search-grounded (Limitless/RK9); add LIMITLESS_API_KEY for exact data"}`);
  const es = emailStatus();
  console.log(`  email: ${es.provider === "none" ? "off (set BREVO_API_KEY+BREVO_FROM — works behind SMTP blocks)" : es.note}`);
  if (cloud.hasCloud) {
    cloud.initCloud()
      .then(() => console.log("  cloud accounts + sync: on (Postgres) — accounts sync across devices"))
      .catch((e) => console.error(`  ⚠  cloud DB init failed: ${e instanceof Error ? e.message : e}`));
  } else {
    console.log("  cloud accounts + sync: off (set DATABASE_URL to enable cross-device accounts)");
  }
  if (!hasApiKey) {
    console.log("  ⚠  GEMINI_API_KEY is not set — get a free key at https://aistudio.google.com/apikey and add it to .env.");
  }
  console.log(`  morning briefing: generated server-side daily, cached & shared (auto-refreshes while the server is awake)`);
  startDigestScheduler();
});
