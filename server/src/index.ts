import "./env.js";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import { ApiError } from "@google/genai";
import { ai, MODEL, hasApiKey } from "./gemini.js";
import { scanSchema, tradeSchema } from "./schemas.js";
import {
  scanSystemPrompt,
  tradeSystemPrompt,
  chatSystemPrompt,
  type Settings,
} from "./prompts.js";

const app = express();
app.use(cors());
// Card photos arrive as base64 JSON, so allow a generous body size.
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT) || 8787;

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

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

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, provider: "google-gemini", model: MODEL, hasApiKey });
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

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: "Scan this trading card and return the full structured analysis." },
          ],
        },
      ],
      config: {
        systemInstruction: scanSystemPrompt(settings || {}),
        responseMimeType: "application/json",
        responseSchema: scanSchema as any,
      },
    });

    res.json(parseJson(response.text));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Evaluate a proposed trade --------------------------------------------
app.post("/api/trade", async (req: Request, res: Response) => {
  if (!apiKeyGuard(res)) return;

  const { yourSide, theirSide, settings } = req.body as {
    yourSide?: string;
    theirSide?: string;
    settings?: Settings;
  };

  if (!yourSide?.trim() || !theirSide?.trim()) {
    res.status(400).json({ error: "Describe both sides of the trade." });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents:
        `Evaluate this trade.\n\nWhat I give up (my side):\n${yourSide}\n\n` +
        `What I receive (their side):\n${theirSide}`,
      config: {
        systemInstruction: tradeSystemPrompt(settings || {}),
        responseMimeType: "application/json",
        responseSchema: tradeSchema as any,
      },
    });

    res.json(parseJson(response.text));
  } catch (err) {
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// --- Streaming chat --------------------------------------------------------
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
        systemInstruction: chatSystemPrompt(settings || {}, cardContext),
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
  console.log(`  provider: google-gemini  model: ${MODEL}`);
  if (!hasApiKey) {
    console.log("  ⚠  GEMINI_API_KEY is not set — get a free key at https://aistudio.google.com/apikey and add it to .env.");
  }
});
