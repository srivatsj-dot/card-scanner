import type { ScanResult, TradeResult, AskResult, Settings, ChatMessage, CardEntry, BulkCard, TradeUpResult, DigestResult } from "./types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Strip the data-URL prefix and return { base64, mediaType }. */
export function splitDataUrl(dataUrl: string): { base64: string; mediaType: string } {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Could not read image data.");
  return { mediaType: match[1], base64: match[2] };
}

export function scanCard(dataUrls: string[], settings: Settings): Promise<ScanResult> {
  const images = dataUrls.map((d) => {
    const { base64, mediaType } = splitDataUrl(d);
    return { imageBase64: base64, mediaType };
  });
  return postJson<ScanResult>("/api/scan", { images, settings });
}

/** Look up a card from a typed description (no photo). */
export function searchCard(text: string, settings: Settings): Promise<ScanResult> {
  return postJson<ScanResult>("/api/scan", { text, settings });
}

/** Fire-and-forget welcome email on sign-up. No-op if email isn't configured. */
export function notifySignup(email: string, username: string): Promise<void> {
  return fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username }),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Bulk scan one photo that may contain several cards; returns every card found. */
export function bulkScan(dataUrl: string, settings: Settings): Promise<{ cards: BulkCard[] }> {
  const { base64, mediaType } = splitDataUrl(dataUrl);
  return postJson<{ cards: BulkCard[] }>("/api/bulk", {
    images: [{ imageBase64: base64, mediaType }],
    settings,
  });
}

/** Convert UI card entries into the server's {text, imageBase64, mediaType} shape. */
function entriesToServer(entries: CardEntry[]) {
  return entries
    .filter((e) => e.text.trim() || e.dataUrl)
    .map((e) => {
      const out: { text?: string; imageBase64?: string; mediaType?: string } = {};
      if (e.text.trim()) out.text = e.text.trim();
      if (e.dataUrl) {
        const { base64, mediaType } = splitDataUrl(e.dataUrl);
        out.imageBase64 = base64;
        out.mediaType = mediaType;
      }
      return out;
    });
}

export function evaluateTrade(
  yourSide: CardEntry[],
  theirSide: CardEntry[],
  settings: Settings
): Promise<TradeResult> {
  return postJson<TradeResult>("/api/trade", {
    mode: "fairness",
    yourSide: entriesToServer(yourSide),
    theirSide: entriesToServer(theirSide),
    settings,
  });
}

/** Plan a chain of fair trades from owned cards toward a target grail. */
export function planTradeUp(target: string, owned: string[], settings: Settings): Promise<TradeUpResult> {
  return postJson<TradeUpResult>("/api/tradeup", { target, owned, settings });
}

/** Daily briefing for a specific date (YYYY-MM-DD) and the given categories. */
export function getDigest(
  date: string,
  sports: string[],
  players: string[],
  wishlist: string[],
  settings: Settings
): Promise<DigestResult> {
  return postJson<DigestResult>("/api/digest", { date, sports, players, wishlist, settings });
}

export function suggestAsks(yourSide: CardEntry[], settings: Settings): Promise<AskResult> {
  return postJson<AskResult>("/api/trade", {
    mode: "suggest",
    yourSide: entriesToServer(yourSide),
    settings,
  });
}

/** Streamed chat. Calls onDelta for each text chunk; resolves when done. */
export async function streamChat(
  messages: ChatMessage[],
  settings: Settings,
  cardContext: unknown,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, settings, cardContext }),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const block of events) {
      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice(7).trim();
      const data = JSON.parse(dataLine.slice(6));
      if (event === "delta") onDelta(data.text as string);
      else if (event === "error") throw new Error(data.message || "Chat error");
    }
  }
}
