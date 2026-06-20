import "./env.js";
import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import type { Request, Response } from "express";
import { ApiError } from "@google/genai";
import { ai, MODEL, hasApiKey } from "./gemini.js";
import { scanSchema, tradeSchema, askSchema, bulkSchema } from "./schemas.js";
import {
  scanSystemPrompt,
  bulkSystemPrompt,
  tradeSystemPrompt,
  askSystemPrompt,
  chatSystemPrompt,
  type Settings,
} from "./prompts.js";

const app = express();
app.use(cors());
// Card photos arrive as base64 JSON, so allow a generous body size.
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT) || 8787;

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
function parseJson<T>(text: string | undefined): T {
  if (!text) throw new Error("The model returned an empty response.");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
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
        `\n\nRespond with ONLY a single JSON object (no markdown fences, no commentary) conforming to this JSON schema:\n${JSON.stringify(schema)}`,
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
    res.json(await analyze(sys, scanParts, scanSchema, groundedFor(settings)));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

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

  const { mode, yourSide, theirSide, settings } = req.body as {
    mode?: "fairness" | "suggest";
    yourSide?: CardEntry[];
    theirSide?: CardEntry[];
    settings?: Settings;
  };

  const giving = (yourSide || []).filter(entryHasContent);
  const receiving = (theirSide || []).filter(entryHasContent);

  if (giving.length === 0) {
    res.status(400).json({ error: "Add at least one card you're giving up." });
    return;
  }

  try {
    if (mode === "suggest") {
      const sys = askSystemPrompt(settings || {});
      const parts: Part[] = [
        { text: "I want to trade away the following card(s). Tell me what I should ask for in return." },
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
    const parts: Part[] = [
      { text: "Evaluate whether this trade is fair." },
      ...sideToParts("Cards I give up (my side)", giving),
      ...sideToParts("Cards I receive (their side)", receiving),
    ];
    res.json(await analyze(sys, parts, tradeSchema, groundedFor(settings)));
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
      `Return ONLY a JSON object that maps each ORIGINAL English string (exact key) to its natural ${language} translation. ` +
      `Keep emojis, numbers, currency, punctuation, and placeholders like "(3)" or "/150" intact. Keep it concise for a mobile UI. ` +
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

app.post("/api/notify", async (req: Request, res: Response) => {
  const { email, username } = req.body as { email?: string; username?: string };
  const to = (email || "").trim();
  if (!emailOk(to)) {
    res.status(400).json({ ok: false, error: "Invalid email." });
    return;
  }
  const name = escapeHtml((username || "there").toString().slice(0, 60));
  const subject = "Welcome to Card-O-Rama 🎴";
  const html = welcomeHtml(name);

  try {
    // 1) Gmail SMTP (free, no domain needed).
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });
      await transporter.sendMail({ from: `Card-O-Rama <${GMAIL_USER}>`, to, subject, html });
      res.json({ ok: true, via: "gmail" });
      return;
    }
    // 2) Resend (needs a verified domain to email anyone).
    if (RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        res.status(502).json({ ok: false, error: `Email send failed (${r.status}). ${text.slice(0, 200)}` });
        return;
      }
      res.json({ ok: true, via: "resend" });
      return;
    }
    // Not configured — succeed quietly so sign-up isn't blocked.
    res.json({ ok: false, reason: "email-not-configured" });
  } catch (e) {
    res.status(502).json({ ok: false, error: e instanceof Error ? e.message : "Email send failed." });
  }
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
  if (!hasApiKey) {
    console.log("  ⚠  GEMINI_API_KEY is not set — get a free key at https://aistudio.google.com/apikey and add it to .env.");
  }
});
