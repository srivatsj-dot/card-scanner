import "./env.js";
import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import type { Request, Response } from "express";
import { ApiError } from "@google/genai";
import { ai, MODEL, hasApiKey } from "./gemini.js";
import { ebayPrice, hasEbay } from "./ebay.js";
import { verifiedSportsFacts, hasLimitless } from "./sports.js";
import { scanSchema, tradeSchema, askSchema, bulkSchema, tradeUpSchema, digestSchema, checklistSchema } from "./schemas.js";
import {
  scanSystemPrompt,
  bulkSystemPrompt,
  tradeSystemPrompt,
  askSystemPrompt,
  offerSystemPrompt,
  tradeUpSystemPrompt,
  digestSystemPrompt,
  checklistSystemPrompt,
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
    if (!m) continue; // no verifiable date → drop
    if (m[1] < start || m[1] > end) continue; // tagged outside the window → drop
    const text = raw.slice(m[0].length).trim();
    if (!text) continue;
    // Reject if the sentence itself cites a day outside the window.
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
      error:
        "No GEMINI_API_KEY configured on the server. Get a free key at https://aistudio.google.com/apikey, then add it to .env.",
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
        message:
          "Gemini free-tier rate limit hit. Wait a minute and try again, or check quota in Google AI Studio.",
      };
    }
    if (err.status === 400 && /api key/i.test(err.message)) {
      return { status: 401, message: "Invalid GEMINI_API_KEY." };
    }
    return { status: err.status || 500, message: err.message };
  }
  return { status: 500, message: err instanceof Error ? err.message : "Unexpected server error." };
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
async function groundedJson<T>(model: string, systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: NO_THINKING,
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
    return structure<T>(model, systemInstruction, text, schema);
  }
}

/** Reshape free text into the structured schema (fallback / non-grounded helper). */
async function structure<T>(model: string, systemInstruction: string, analysis: string, schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents:
      "Convert the following analysis into the required JSON. Use only facts present in the analysis; do not invent new details.\n\n" +
      analysis,
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: NO_THINKING,
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/** Single-pass structured generation, no grounding. */
async function structuredDirect<T>(model: string, systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT,
      thinkingConfig: NO_THINKING,
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
async function analyze<T>(systemInstruction: string, parts: Part[], schema: unknown, grounded: boolean): Promise<T> {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      if (!grounded) return await structuredDirect<T>(model, systemInstruction, parts, schema);
      try {
        return await groundedJson<T>(model, systemInstruction, parts, schema);
      } catch (err) {
        if (isRateLimit(err)) throw err; // let the model-fallback loop handle it
        return await structuredDirect<T>(model, systemInstruction, parts, schema); // empty/grounding issue
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
  res.json({ ok: true, provider: "google-gemini", model: MODEL, grounding: USE_GROUNDING, hasApiKey });
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
    const result = await analyze<ScanResultShape>(sys, scanParts, scanSchema, groundedFor(settings));
    await applyEbayPrice(result, settings);
    res.json(result);
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// Minimal shape we need to read/override on a scan result.
interface ScanResultShape {
  identified?: boolean;
  player?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  specialEdition?: string | null;
  serialNumber?: string | null;
  estimatedValue?: { low: number; mid: number; high: number; currency: string; note: string };
}

function cardQuery(r: ScanResultShape): string {
  return [r.year, r.manufacturer, r.setName, r.player, r.parallel, r.cardNumber ? `#${r.cardNumber}` : "", r.serialNumber]
    .map((x) => (x || "").toString().trim())
    .filter(Boolean)
    .join(" ");
}

// Replace the model's value with a real eBay-listings range when available.
async function applyEbayPrice(result: ScanResultShape, settings?: Settings) {
  if (!hasEbay || !result?.identified || !result.estimatedValue) return;
  const ep = await ebayPrice(cardQuery(result), settings?.region);
  if (!ep) return;
  result.estimatedValue = {
    low: Math.round(ep.low),
    mid: Math.round(ep.mid),
    high: Math.round(ep.high),
    currency: ep.currency,
    note: `Based on ${ep.count} current eBay listings (${ep.currency}). Asking prices — actual sold prices run a bit lower.`,
  };
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
    res.json(await analyze(sys, parts, bulkSchema, groundedFor(settings)));
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
    res.json(await analyze(sys, parts, tradeSchema, groundedFor(settings)));
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

// --- Morning digest: daily market update grouped by sport ------------------
app.post("/api/digest", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;
  const { date, sports, players, wishlist, settings } = req.body as {
    date?: string;
    sports?: string[];
    players?: string[];
    wishlist?: string[];
    settings?: Settings;
  };
  const cats = (sports || []).map((s) => String(s).trim()).filter(Boolean);
  if (cats.length === 0) {
    res.status(400).json({ error: "Enable at least one category for the morning update." });
    return;
  }
  // Target date, clamped to [launch, today].
  const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? (date as string) : today();
  const target = reqDate > today() ? today() : reqDate < LAUNCH_DATE ? LAUNCH_DATE : reqDate;
  // A morning briefing reports what happened the day before. "Yesterday" is the
  // day before the briefing date, floored at launch so we never reach back
  // before the service started.
  const yesterday = addDaysISO(target, -1);
  const windowStart = yesterday < LAUNCH_DATE ? LAUNCH_DATE : yesterday;
  const sys = digestSystemPrompt(settings || {}, cats);
  const mine = (players || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 80);
  const want = (wishlist || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
  // Real, dated game results for baseball/hockey — accurate scores and
  // performances the model can't reliably recall. Best-effort; "" if unavailable.
  const verified = await verifiedSportsFacts(cats, windowStart).catch(() => "");
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
        `If live search turns up little or nothing verifiable for ${windowStart}, RETURN EMPTY ARRAYS rather than filling space with plausible-sounding but unconfirmed events. An honest quiet day is correct; a fabricated busy day is a failure.\n\n` +
        `Among VERIFIED events only, lead with the biggest: top performances (multi-homer games, 40-point nights, no-hitters, hat tricks, walk-offs), milestones, and marquee results. Skip minor transactions, independent/minor leagues, and routine IL moves.\n\n` +
        `MANDATORY FORMAT — every single item in every array (yourCards, yourWishlist, and every bucket) MUST begin with the event's real date in square brackets, e.g. "[${windowStart}] Aaron Judge homered twice as the Yankees beat the Reds." The date is the day the event actually happened, taken from your search results — not a guess. Items are MACHINE-FILTERED after you respond: anything dated outside ${windowStart} to ${target}, or missing a leading [date], is automatically DELETED. So if you can't pin an event to a date inside that range, do not include it at all. Better to return empty arrays than to include undated or out-of-window items.\n` +
        `Do NOT write any calendar date inside the sentence itself (no "on June 19", no "6/19") — the leading [date] tag is the ONLY place a date goes, and the sentence is stripped of nothing else. An item whose sentence mentions a day outside ${windowStart}–${target} is also deleted, so never reference an out-of-window day. Do not tag an item with an in-window date while describing something that actually happened earlier — that is dishonest and will be discarded.\n\n` +
        (verified
          ? `=== VERIFIED RESULTS (authoritative — pulled directly from official league data for ${windowStart}) ===\n${verified}\n\n` +
            `For the sports covered by this VERIFIED block, build "risingStars" and "storylines" ONLY from these real results — these scores and stat lines are correct and correctly dated. Do NOT add, invent, search for, or "remember" any other games or performances for those sports. Pick the most notable lines (multi-HR/multi-goal games, gems, marquee or close finals), write each as one vivid sentence, and tag it [${windowStart}]. You may still use search for those sports' "trades" and "news" (transactions, set/market news) and for any sport NOT in the verified block.\n\n`
          : "") +
        (mine.length ? `The collector's BINDER players/cards:\n- ${mine.join("\n- ")}\n\n` : "") +
        (want.length ? `The collector's WISHLIST cards:\n- ${want.join("\n- ")}\n\n` : "") +
        `Write the briefing for ${target} (covering ${windowStart}), for these categories: ${cats.join(", ")}.`,
    },
  ];
  try {
    const result = await analyze<DigestShape>(sys, parts, digestSchema, groundedFor(settings));
    // Deterministically enforce the time window: every item is date-tagged, so
    // we keep only those inside [windowStart, target] and strip the tag.
    const clean: DigestShape = {
      overview: result.overview,
      yourCards: keepInWindow(result.yourCards, windowStart, target),
      yourWishlist: keepInWindow(result.yourWishlist, windowStart, target),
      sections: (result.sections || []).map((s) => ({
        sport: s.sport,
        risingStars: keepInWindow(s.risingStars, windowStart, target),
        declining: keepInWindow(s.declining, windowStart, target),
        storylines: keepInWindow(s.storylines, windowStart, target),
        trades: keepInWindow(s.trades, windowStart, target),
        chase: keepInWindow(s.chase, windowStart, target),
        news: keepInWindow(s.news, windowStart, target),
      })),
    };
    res.json(clean);
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
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
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
async function sendEmail(to: string, subject: string, html: string, tag: string): Promise<SendResult> {
  try {
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });
      await transporter.sendMail({ from: `Card-O-Rama <${GMAIL_USER}>`, to, subject, html });
      return { ok: true, via: "gmail" };
    }
    if (RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // Most common cause: no verified domain, so Resend's sandbox only lets
        // you email your OWN address (and only from onboarding@resend.dev).
        const hint =
          r.status === 403 || /domain|verif|testing|own email/i.test(text)
            ? " Resend can only email arbitrary addresses once you've verified a domain (and set EMAIL_FROM to it). Without one it only sends to your own Resend account email. For emailing anyone with no domain, use Gmail (GMAIL_USER + GMAIL_APP_PASSWORD)."
            : "";
        console.warn(`[${tag}] Resend send failed (${r.status}): ${text.slice(0, 300)}`);
        return { ok: false, status: 502, error: `Email send failed (${r.status}). ${text.slice(0, 200)}${hint}` };
      }
      return { ok: true, via: "resend" };
    }
    console.warn(`[${tag}] No email provider configured (set GMAIL_USER+GMAIL_APP_PASSWORD or RESEND_API_KEY).`);
    return { ok: false, reason: "email-not-configured" };
  } catch (e) {
    console.warn(`[${tag}] send threw: ${e instanceof Error ? e.message : e}`);
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "Email send failed." };
  }
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

// In production, serve the built web app from the same origin as the API, so
// the whole thing deploys as ONE unit on ONE domain: no CORS, and the UI's
// relative /api calls just work. In dev the Vite server serves the UI instead,
// so this only kicks in once `web/dist` has been built.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const servingWeb = existsSync(join(webDist, "index.html"));
if (servingWeb) {
  app.use(express.static(webDist));
  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(join(webDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`card-scanner API listening on http://localhost:${PORT}`);
  console.log(`  provider: google-gemini  models: ${MODELS.join(" → ")}  grounding: ${USE_GROUNDING ? "on" : "off"}`);
  if (servingWeb) console.log(`  serving web app from ${webDist}`);
  console.log(`  eBay pricing: ${hasEbay ? "on" : "off (set EBAY_CLIENT_ID/SECRET for real prices)"}`);
  console.log(`  digest sports data: MLB + NHL official, ESPN (NBA, NFL, soccer leagues, World Cup, March Madness…) & ESPNcricinfo (IPL + all cricket) — free, no key`);
  console.log(`  Pokémon TCG results: ${hasLimitless ? "on (Limitless)" : "off (set LIMITLESS_API_KEY for real tournament results)"}`);
  const emailMode = GMAIL_USER && GMAIL_APP_PASSWORD ? `Gmail (${GMAIL_USER})` : RESEND_API_KEY ? "Resend" : "off";
  console.log(`  welcome email: ${emailMode}${emailMode === "off" ? " (set GMAIL_USER+GMAIL_APP_PASSWORD or RESEND_API_KEY)" : ""}`);
  if (!hasApiKey) {
    console.log("  ⚠  GEMINI_API_KEY is not set — get a free key at https://aistudio.google.com/apikey and add it to .env.");
  }
});
