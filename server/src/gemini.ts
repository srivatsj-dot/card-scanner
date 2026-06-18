import { GoogleGenAI } from "@google/genai";

// Default to a free-tier, vision-capable Gemini model.
export const MODEL = process.env.CARD_SCANNER_MODEL || "gemini-2.5-flash";

const apiKey =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

export const hasApiKey = Boolean(apiKey);

// Pass a placeholder when unset so the constructor doesn't throw; request
// handlers gate on `hasApiKey` before making any call.
export const ai = new GoogleGenAI({ apiKey: apiKey || "MISSING_KEY" });
