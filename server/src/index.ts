import "./env.js";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { client, MODEL, hasApiKey, firstText } from "./anthropic.js";
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
        "No ANTHROPIC_API_KEY configured on the server. Copy .env.example to .env and add your key.",
    });
    return false;
  }
  return true;
}

function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "Invalid ANTHROPIC_API_KEY." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Rate limited by the Claude API — try again shortly." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 500, message: err.message };
  }
  return { status: 500, message: err instanceof Error ? err.message : "Unexpected server error." };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, model: MODEL, hasApiKey });
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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 10000,
      thinking: { type: "adaptive" },
      system: scanSystemPrompt(settings || {}),
      output_config: {
        format: { type: "json_schema", schema: scanSchema as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as any, data: imageBase64 },
            },
            {
              type: "text",
              text: "Scan this trading card and return the full structured analysis.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to analyze this image." });
      return;
    }

    const text = firstText(response.content);
    res.json(JSON.parse(text));
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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      system: tradeSystemPrompt(settings || {}),
      output_config: {
        format: { type: "json_schema", schema: tradeSchema as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: "user",
          content:
            `Evaluate this trade.\n\nWhat I give up (my side):\n${yourSide}\n\n` +
            `What I receive (their side):\n${theirSide}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to evaluate this trade." });
      return;
    }

    res.json(JSON.parse(firstText(response.content)));
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
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      system: chatSystemPrompt(settings || {}, cardContext),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    stream.on("text", (delta) => send("delta", { text: delta }));

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send("error", { message: "The model declined to respond." });
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
  console.log(`  model: ${MODEL}`);
  if (!hasApiKey) {
    console.log("  ⚠  ANTHROPIC_API_KEY is not set — copy .env.example to .env and add your key.");
  }
});
