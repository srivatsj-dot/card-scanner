import { useEffect, useState } from "react";
import type { SavedCard } from "../types";
import { money } from "../utils";
import { useT } from "../translator";
import {
  toTradeCard, listCard, myListings, removeListing, browseBoard,
  makeOffer, getOffers, respondOffer,
  type Listing, type Offer, type TradeCard,
} from "../tradeboard";

function CardChip({ c }: { c: TradeCard }) {
  return (
    <div className="tb-card">
      {c.thumb ? <img className="thumb" src={c.thumb} alt="" /> : <div className="thumb placeholder">🃏</div>}
      <div style={{ minWidth: 0 }}>
        <div className="tb-name">{c.player}</div>
        <div className="muted" style={{ fontSize: 12 }}>{[c.year, c.setName].filter(Boolean).join(" · ") || c.sport}</div>
        <div className="value-big" style={{ fontSize: 15 }}>{money(c.value, c.currency)}</div>
      </div>
    </div>
  );
}

export default function TradeBoardView({ saved }: { saved: SavedCard[] }) {
  const t = useT();
  const [tab, setTab] = useState<"browse" | "listings" | "offers">("browse");
  const [board, setBoard] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [offers, setOffers] = useState<{ incoming: Offer[]; outgoing: Offer[] }>({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<Listing | null>(null); // listing being offered on
  const [pickList, setPickList] = useState(false); // "list a card" picker
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      if (tab === "browse") setBoard((await browseBoard()).listings);
      else if (tab === "listings") setMine((await myListings()).listings);
      else setOffers(await getOffers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the trade board.");
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tab]);

  async function doList(c: SavedCard) {
    setBusy(true);
    try { await listCard(toTradeCard(c)); setPickList(false); if (tab === "listings") load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't list it."); }
    finally { setBusy(false); }
  }
  async function doRemove(id: number) {
    await removeListing(id).catch(() => {});
    setMine((m) => m.filter((x) => x.id !== id));
  }
  async function doRespond(id: number, accept: boolean) {
    setBusy(true);
    try { await respondOffer(id, accept); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't respond."); }
    finally { setBusy(false); }
  }

  const navBtn = (v: typeof tab, label: string, n?: number) => (
    <button className={`seg ${tab === v ? "active" : ""}`} onClick={() => setTab(v)}>
      {label}{n ? ` (${n})` : ""}
    </button>
  );

  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t("Trade board")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("List cards you'll trade, browse what others are offering, and make trade offers. When an offer is accepted you'll both get each other's email to arrange it.")}
        </p>
        <div className="segbar">
          {navBtn("browse", t("Browse"))}
          {navBtn("listings", t("My listings"), mine.length || undefined)}
          {navBtn("offers", t("Offers"), offers.incoming.filter((o) => o.status === "pending").length || undefined)}
        </div>
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        {loading && <p className="muted" style={{ marginTop: 12 }}><span className="spinner" />{t("Loading…")}</p>}
      </div>

      {/* BROWSE */}
      {tab === "browse" && !loading && (
        board.length === 0 ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>{t("No one's listed a card yet. Be the first from My listings!")}</p></div>
        ) : board.map((l) => (
          <div className="card" key={l.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <CardChip c={l.card} />
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: 12 }}>{t("from")} {l.owner}</div>
                <button className="btn small" style={{ marginTop: 6 }} onClick={() => setOfferFor(l)}>{t("Offer a trade")}</button>
              </div>
            </div>
          </div>
        ))
      )}

      {/* MY LISTINGS */}
      {tab === "listings" && !loading && (
        <>
          <div className="card">
            <button className="btn" onClick={() => setPickList(true)} disabled={saved.length === 0}>
              + {t("List a card for trade")}
            </button>
            {saved.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>{t("Add cards to your binder first.")}</p>}
          </div>
          {mine.map((l) => (
            <div className="card" key={l.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <CardChip c={l.card} />
                <button className="btn ghost small" onClick={() => doRemove(l.id)}>{t("Remove")}</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* OFFERS */}
      {tab === "offers" && !loading && (
        <>
          <h3 style={{ margin: "4px 4px 8px" }}>{t("Incoming")}</h3>
          {offers.incoming.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>{t("No offers yet.")}</p></div>}
          {offers.incoming.map((o) => (
            <div className="card" key={o.id}>
              <div className="muted" style={{ fontSize: 13 }}>{o.other} {t("wants your")}:</div>
              <CardChip c={o.requested} />
              <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("and offers you")}:</div>
              {o.offered.map((c, i) => <CardChip c={c} key={i} />)}
              {o.note && <p style={{ fontSize: 14 }}>"{o.note}"</p>}
              {o.status === "pending" ? (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn small" disabled={busy} onClick={() => doRespond(o.id, true)}>✓ {t("Accept")}</button>
                  <button className="btn ghost small" disabled={busy} onClick={() => doRespond(o.id, false)}>{t("Decline")}</button>
                </div>
              ) : o.status === "accepted" ? (
                <p style={{ marginTop: 8, fontSize: 14 }}>✅ {t("Accepted — contact")} <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> {t("to arrange it.")}</p>
              ) : (
                <p className="muted" style={{ marginTop: 8 }}>{t("Declined")}</p>
              )}
            </div>
          ))}

          <h3 style={{ margin: "18px 4px 8px" }}>{t("Sent")}</h3>
          {offers.outgoing.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>{t("You haven't made any offers.")}</p></div>}
          {offers.outgoing.map((o) => (
            <div className="card" key={o.id}>
              <div className="muted" style={{ fontSize: 13 }}>{t("You offered")} {o.other} {t("for their")}:</div>
              <CardChip c={o.requested} />
              {o.status === "accepted"
                ? <p style={{ marginTop: 8, fontSize: 14 }}>✅ {t("Accepted — contact")} <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a></p>
                : <p className="muted" style={{ marginTop: 8 }}>{o.status === "pending" ? t("Waiting for a reply…") : t("Declined")}</p>}
            </div>
          ))}
        </>
      )}

      {/* Offer modal: pick which of your cards to offer */}
      {offerFor && (
        <OfferModal listing={offerFor} saved={saved} onClose={() => setOfferFor(null)}
          onSent={() => { setOfferFor(null); setTab("offers"); }} setError={setError} />
      )}

      {/* List-a-card picker */}
      {pickList && (
        <div className="cam-overlay" onClick={() => setPickList(false)}>
          <div className="cam-box" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "80vh", overflow: "auto" }}>
            <h3 style={{ marginTop: 0 }}>{t("Pick a card to list")}</h3>
            {saved.map((c) => (
              <button key={c.id} className="tb-pick" disabled={busy} onClick={() => doList(c)}>
                <CardChip c={toTradeCard(c)} />
              </button>
            ))}
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPickList(false)}>{t("Cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function OfferModal({ listing, saved, onClose, onSent, setError }: {
  listing: Listing; saved: SavedCard[]; onClose: () => void; onSent: () => void; setError: (s: string) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function send() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const offered = saved.filter((c) => picked.has(c.id)).map(toTradeCard);
      await makeOffer(listing.id, offered, note);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the offer.");
      setBusy(false);
    }
  }

  return (
    <div className="cam-overlay" onClick={onClose}>
      <div className="cam-box" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ marginTop: 0 }}>{t("Offer for")} {listing.card.player}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{t("Pick the card(s) you'll give:")}</p>
        {saved.length === 0 && <p className="muted">{t("Your binder is empty.")}</p>}
        {saved.map((c) => (
          <button key={c.id} className={`tb-pick ${picked.has(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)}>
            <CardChip c={toTradeCard(c)} />
            {picked.has(c.id) && <span className="tb-check">✓</span>}
          </button>
        ))}
        <textarea className="field" style={{ width: "100%", marginTop: 10 }} rows={2}
          placeholder={t("Add a note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn" disabled={busy || picked.size === 0} onClick={send}>
            {busy ? <><span className="spinner" />{t("Sending…")}</> : t("Send offer")}
          </button>
          <button className="btn ghost" onClick={onClose}>{t("Cancel")}</button>
        </div>
      </div>
    </div>
  );
}
