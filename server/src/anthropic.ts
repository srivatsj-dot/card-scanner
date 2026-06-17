import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CARD_SCANNER_MODEL || "claude-opus-4-8";

export const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

// Resolves ANTHROPIC_API_KEY from the environment automatically.
export const client = new Anthropic();

/** Pull the first text block out of a Messages response. */
export function firstText(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}
