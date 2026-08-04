import type { ScanResult, TradeResult, AskResult, Settings, ChatMessage, CardEntry, BulkCard, TradeUpResult, DigestResult, ChecklistResult, TradeOffer } from "./types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
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

/**
 * Fast re-price of an already-identified card (used by the binder refresh).
 * Skips the AI entirely and asks the live price sources, so refreshing a whole
 * binder takes seconds instead of minutes. `estimatedValue` is null when there's
 * no live price, meaning "leave this card as it is".
 */
export function quickPrice(card: ScanResult, settings: Settings): Promise<{ estimatedValue: ScanResult["estimatedValue"] | null }> {
  return postJson<{ estimatedValue: ScanResult["estimatedValue"] | null }>("/api/quick-price", { card, settings });
}

/** Price a card at a professional grade (e.g. PSA 10), plus its raw value. */
export interface GradePriceResult {
  graded: { low: number; mid: number; high: number; currency: string; count: number; note: string } | null;
  raw: { mid: number; currency: string; count: number } | null;
}
export function gradePrice(card: ScanResult, company: string, grade: string, settings: Settings): Promise<GradePriceResult> {
  return postJson<GradePriceResult>("/api/grade-price", { card, company, grade, settings });
}

/** Refine a result's price against recent sold comps (runs after the scan shows). */
export function verifyPrice(card: ScanResult, settings: Settings): Promise<{ estimatedValue: ScanResult["estimatedValue"] }> {
  return postJson<{ estimatedValue: ScanResult["estimatedValue"] }>("/api/price-check", { card, settings });
}

export interface NotifyResult {
  ok: boolean;
  via?: string;
  reason?: string;
  error?: string;
}

async function postNotify(path: string, body: unknown): Promise<NotifyResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false, error: "Bad response." }))) as NotifyResult;
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/** Send the welcome email. Resolves with the server's result (never throws). */
export function notifySignup(email: string, username: string): Promise<NotifyResult> {
  return postNotify("/api/notify", { email, username });
}

/** Email a one-time password-reset code. Resolves with the server's result. */
export function sendResetCode(email: string, username: string, code: string): Promise<NotifyResult> {
  return postNotify("/api/reset-code", { email, username, code });
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

/** Create a shareable trade offer; returns its id (link is /offer/<id>). */
export function createOffer(
  from: string,
  give: string[],
  get: string[],
  trade: TradeResult | null,
  currency: string
): Promise<{ id: string }> {
  return postJson<{ id: string }>("/api/offer", { from, give, get, trade, currency });
}

/** Fetch a trade offer (public — this is what the recipient's link loads). */
export async function getOffer(id: string): Promise<TradeOffer> {
  const res = await fetch(`/api/offer/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as TradeOffer;
}

/** Respond to an offer: accept, decline, or ask for a change (with a note). */
export function respondOffer(id: string, action: "accept" | "decline" | "change", message?: string): Promise<TradeOffer> {
  return postJson<TradeOffer>(`/api/offer/${encodeURIComponent(id)}/respond`, { action, message });
}

/** Daily briefing for a specific date (YYYY-MM-DD) and the given categories. */
export function getDigest(
  date: string,
  sports: string[],
  players: string[],
  wishlist: string[],
  /** Player names behind the wishlist cards, so news can be matched to them. */
  wishlistNames: string[],
  settings: Settings,
  refresh = false
): Promise<DigestResult> {
  // `refresh` tells the server to throw away the cached briefing for that day
  // and write it again — the way out of a briefing that came back badly.
  return postJson<DigestResult>("/api/digest", { date, sports, players, wishlist, wishlistNames, settings, refresh });
}

/** Set-completion checklist: base-set size + the notable cards still missing. */
export function getChecklist(
  set: { year?: string; manufacturer?: string; setName?: string; sport?: string },
  ownedNumbers: string[],
  settings: Settings
): Promise<ChecklistResult> {
  return postJson<ChecklistResult>("/api/checklist", { set, ownedNumbers, settings });
}

export function suggestAsks(yourSide: CardEntry[], settings: Settings): Promise<AskResult> {
  return postJson<AskResult>("/api/trade", {
    mode: "suggest",
    yourSide: entriesToServer(yourSide),
    settings,
  });
}

/** "Who should I give?" — name a card you want; get fair packages to offer. */
export function suggestOffer(theirSide: CardEntry[], owned: string[], settings: Settings): Promise<AskResult> {
  return postJson<AskResult>("/api/trade", {
    mode: "offer",
    theirSide: entriesToServer(theirSide),
    owned,
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

/** One thing the assistant wants the app to do. */
export interface AssistantAction {
  type: string;
  text?: string | null;
  query?: string | null;
  view?: string | null;
  company?: string | null;
  grade?: string | null;
  on?: boolean | null;
}
/**
 * The in-app assistant: answers using a snapshot of the collector's own data and
 * can return actions for the app to carry out.
 */
export function askAssistant(
  messages: ChatMessage[],
  settings: Settings,
  context: unknown
): Promise<{ reply: string; actions: AssistantAction[] }> {
  return postJson<{ reply: string; actions: AssistantAction[] }>("/api/assistant", { messages, settings, context });
}
