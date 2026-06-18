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

/** Pass 1: free-text analysis with live Google Search grounding. */
async function groundedResearch(systemInstruction: string, parts: Part[]): Promise<string> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction:
        systemInstruction +
        `\n\nToday's date is ${today()}. Use Google Search to verify the subject's CURRENT form/standing and the card's CURRENT market value before you judge outlook or price — do not rely on memory for anything time-sensitive. Write a thorough plain-text analysis covering every point you'll later need.`,
      tools: [{ googleSearch: {} }],
    },
  });
  const text = response.text;
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

/** Pass 2: reshape a free-text analysis into the structured schema (no new facts). */
async function structure<T>(systemInstruction: string, analysis: string, schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents:
      "Convert the following analysis into the required JSON. Use only facts present in the analysis; do not invent new details.\n\n" +
      analysis,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
}

/** Single-pass structured generation (used when grounding is disabled). */
async function structuredDirect<T>(systemInstruction: string, parts: Part[], schema: unknown): Promise<T> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: schema as any,
    },
  });
  return parseJson<T>(response.text);
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

  try {
    let result;
    if (USE_GROUNDING) {
      const analysis = await groundedResearch(sys, [
        imagePart,
        {
          text:
            "Identify this exact trading card (subject, set, year, card number, parallel, serial number, special edition). " +
            "Then research the subject's current form/standing and recent comparable sale prices for this specific card. " +
            "Summarize everything needed: value range, hidden insights, current outlook, and good comparable cards to trade toward.",
        },
      ]);
      result = await structure(sys, analysis, scanSchema);
    } else {
      result = await structuredDirect(
        sys,
        [imagePart, { text: "Scan this trading card and return the full structured analysis." }],
        scanSchema
      );
    }
    res.json(result);
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
      const result = USE_GROUNDING
        ? await structure(sys, await groundedResearch(sys, parts), askSchema)
        : await structuredDirect(sys, parts, askSchema);
      res.json(result);
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
    const result = USE_GROUNDING
      ? await structure(sys, await groundedResearch(sys, parts), tradeSchema)
      : await structuredDirect(sys, parts, tradeSchema);
    res.json(result);
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

  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      // Gemini uses "model" for the assistant role.
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction:
          chatSystemPrompt(settings || {}, cardContext) +
          `\n\nToday's date is ${today()}. When a question depends on current form, news, or prices, use Google Search rather than memory.`,
        ...(USE_GROUNDING ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

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
