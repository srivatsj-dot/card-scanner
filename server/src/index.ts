import "./env.js";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import { ApiError } from "@google/genai";
import { ai, MODEL, hasApiKey } from "./gemini.js";
import { scanSchema, tradeSchema, askSchema } from "./schemas.js";
import {
  scanSystemPrompt,
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

/** Call Gemini, retrying briefly on transient 429s to smooth free-tier bursts. */
async function generate(params: Parameters<typeof ai.models.generateContent>[0]) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiError && err.status === 429 && attempt < 2) {
        await sleep((attempt + 1) * 2000); // 2s, then 4s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Single grounded call that returns JSON. Google Search grounding can't be
 * combined with responseSchema, so we ask for JSON in the prompt and parse it.
 * Uses a plain (non-retrying) call so a rate limit degrades quickly to the
 * non-grounded path in analyze().
 */
async function groundedJson<T>(systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
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
    // Rare: grounded output wasn't clean JSON — reshape it with a schema pass.
    return structure<T>(systemInstruction, text, schema);
  }
}

/** Reshape free text into the structured schema (fallback / non-grounded helper). */
async function structure<T>(systemInstruction: string, analysis: string, schema: unknown): Promise<T> {
  const response = await generate({
    model: MODEL,
    contents:
      "Convert the following analysis into the required JSON. Use only facts present in the analysis; do not invent new details.\n\n" +
      analysis,
    config: {
      temperature: ANALYZE_TEMPERATURE,
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/** Single-pass structured generation, no grounding. */
async function structuredDirect<T>(systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  const response = await generate({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      temperature: ANALYZE_TEMPERATURE,
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/**
 * Produce a structured result, preferring live grounding but degrading
 * gracefully: if grounding is rate-limited or unavailable, fall back to a
 * plain structured call so the user still gets an answer.
 */
async function analyze<T>(systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  if (!USE_GROUNDING) return structuredDirect<T>(systemInstruction, parts, schema);
  try {
    return await groundedJson<T>(systemInstruction, parts, schema);
  } catch (err) {
    if (err instanceof ApiError) {
      // Grounding quota hit (or grounding unavailable) — retry without it.
      return structuredDirect<T>(systemInstruction, parts, schema);
    }
    throw err;
  }
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, provider: "google-gemini", model: MODEL, grounding: USE_GROUNDING, hasApiKey });
});

// --- Scan a card image -----------------------------------------------------
app.post("/api/scan", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const { imageBase64, mediaType, settings } = req.body as {
    imageBase64?: string;
    mediaType?: string;
    settings?: Settings;
  };

  if (!imageBase64 || !mediaType) {
    res.status(400).json({ error: "imageBase64 and mediaType are required." });
    return;
  }
  if (!ALLOWED_MEDIA.has(mediaType)) {
    res.status(400).json({ error: `Unsupported image type: ${mediaType}` });
    return;
  }

  const sys = scanSystemPrompt(settings || {});
  const imagePart: Part = { inlineData: { mimeType: mediaType, data: imageBase64 } };
  const scanParts: Part[] = [
    imagePart,
    {
      text:
        "Identify this exact trading card (subject, set, year, card number, parallel, serial number, special edition), " +
        "then research current value and the subject's current form, and return the full structured analysis.",
    },
  ];

  try {
    res.json(await analyze(sys, scanParts, scanSchema));
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
      res.json(await analyze(sys, parts, askSchema));
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
    res.json(await analyze(sys, parts, tradeSchema));
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

  const openStream = (grounded: boolean) =>
    ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
        ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

  try {
    let stream;
    try {
      stream = await openStream(USE_GROUNDING);
    } catch (err) {
      // Grounding rate-limited/unavailable — fall back to a plain stream.
      if (USE_GROUNDING && err instanceof ApiError) stream = await openStream(false);
      else throw err;
    }

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

app.listen(PORT, () => {
  console.log(`card-scanner API listening on http://localhost:${PORT}`);
  console.log(`  provider: google-gemini  model: ${MODEL}  grounding: ${USE_GROUNDING ? "on" : "off"}`);
  if (!hasApiKey) {
    console.log("  ⚠  GEMINI_API_KEY is not set — get a free key at https://aistudio.google.com/apikey and add it to .env.");
  }
});
