// Client for the inter-account trade board. Talks to /api/trade/* with the
// cloud session token. Only meaningful when signed into a cloud account.
import { cloudToken } from "./cloud";
import type { SavedCard } from "./types";

export interface TradeCard {
  player: string;
  year: string;
  setName: string;
  sport: string;
  value: number;
  currency: string;
  thumb: string;
}
export interface Listing { id: number; card: TradeCard; owner?: string; createdAt: number }
export interface Offer {
  id: number;
  requested: TradeCard;
  offered: TradeCard[];
  note: string;
  status: string;
  createdAt: number;
  other: string;
  contactEmail: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tcall<T>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cloudToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** Build the compact card snapshot stored on the trade board. */
export function toTradeCard(c: SavedCard): TradeCard {
  const r = c.result;
  return {
    player: r.player || "Unknown",
    year: r.year || "",
    setName: r.setName || "",
    sport: r.sport || "",
    value: r.estimatedValue?.mid ?? 0,
    currency: r.estimatedValue?.currency || "USD",
    thumb: c.thumbnail || "",
  };
}

export const listCard = (card: TradeCard) => tcall<{ ok: true }>("POST", "/api/trade/list", { card });
export const myListings = () => tcall<{ listings: Listing[] }>("GET", "/api/trade/mine");
export const removeListing = (id: number) => tcall<{ ok: true }>("DELETE", `/api/trade/list/${id}`);
export const browseBoard = () => tcall<{ listings: Listing[] }>("GET", "/api/trade/board");
export const makeOffer = (listingId: number, offered: TradeCard[], note: string) =>
  tcall<{ ok: true }>("POST", "/api/trade/offer", { listingId, offered, note });
export const getOffers = () => tcall<{ incoming: Offer[]; outgoing: Offer[] }>("GET", "/api/trade/offers");
export const pendingCount = () => tcall<{ pending: number }>("GET", "/api/trade/pending");
export const respondOffer = (id: number, accept: boolean) =>
  tcall<{ contactEmail: string | null }>("POST", `/api/trade/offer/${id}/respond`, { accept });
