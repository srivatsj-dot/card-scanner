import { useEffect, useState } from "react";
import type { SavedCard, Settings, TradeResult } from "../types";
import { describeCard, money } from "../utils";
import { evaluateTrade } from "../api";
import {
  marketLookup, marketOffers, marketSendOffer, marketRespond,
  cloudPull, cloudUserKey, type MarketCardDTO, type MarketOfferDTO,
} from "../cloud";
import { useT } from "../translator";
import GuestGate from "./GuestGate";

interface Props {
  saved: SavedCard[];
  settings: Settings;
  cloudOn: boolean;
  isGuest: boolean;
  onRequireLogin: () => void;
}

// Turn one of my SavedCards into the lightweight shape the server stores/moves.
const toDTO = (c: SavedCard): MarketCardDTO => ({
  id: c.id,
  label: describeCard(c.result),
  sport: c.result.sport || "",
  value: c.result.estimatedValue?.mid || 0,
  currency: c.result.estimatedValue?.currency || "USD",
  thumb: c.thumbnail || "",
});

function CardTile({ c, on, onClick }: { c: MarketCardDTO; on: boolean; onClick: () => void }) {
  return (
    <button className={`market-tile ${on ? "sel" : ""}`} onClick={onClick} title={c.label}>
      {c.thumb ? <img src={c.thumb} alt="" /> : <div className="market-tile-ph">🃏</div>}
      <div className="market-tile-label">{c.label}</div>
      <div className="market-tile-val">{money(c.value, c.currency)}</div>
    </button>
  );
}

export default function MarketView({ saved, settings, cloudOn, isGuest, onRequireLogin }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"find" | "offers">("find");
  const [uname, setUname] = useState("");
  const [their, setTheir] = useState<{ display: string; username: string; cards: MarketCardDTO[] } | null>(null);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [want, setWant] = useState<Set<string>>(new Set());
  const [give, setGive] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [offers, setOffers] = useState<{ incoming: MarketOfferDTO[]; outgoing: MarketOfferDTO[] } | null>(null);
  const [fairness, setFairness] = useState<Record<string, TradeResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const mine = saved.map(toDTO);

  async function loadOffers() {
    try { setOffers(await marketOffers()); } catch { /* ignore */ }
  }
  useEffect(() => { if (cloudOn && !isGuest) loadOffers(); }, [cloudOn, isGuest]);

  if (isGuest) return <GuestGate feature="Look up other collectors, browse their binder, and send trade offers." onLogin={onRequireLogin} />;
  if (!cloudOn) {
    return (
      <div className="card">
        <h2>{t("Trade marketplace")}</h2>
        <p className="muted">{t("The marketplace needs cloud accounts, which aren't enabled on this server. Set DATABASE_URL to turn it on.")}</p>
      </div>
    );
  }

  async function lookup() {
    const q = uname.trim();
    if (!q) return;
    setLooking(true); setLookErr(null); setTheir(null); setWant(new Set()); setSent(null);
    try {
      setTheir(await marketLookup(q));
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't find that collector.");
    } finally { setLooking(false); }
  }

  async function send() {
    if (!their) return;
    const giveCards = mine.filter((c) => give.has(c.id));
    const wantCards = their.cards.filter((c) => want.has(c.id));
    if (!giveCards.length || !wantCards.length) return;
    setSending(true);
    try {
      await marketSendOffer(their.username, giveCards, wantCards);
      setSent(their.display);
      setWant(new Set()); setGive(new Set());
      loadOffers();
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't send the offer.");
    } finally { setSending(false); }
  }

  // Check fairness of an INCOMING offer from my perspective: I give `want`, I
  // receive `give`.
  async function checkFair(o: MarketOfferDTO) {
    setBusy(`fair-${o.id}`);
    try {
      const mkEntries = (arr: unknown[]) => (arr as { label?: string }[]).map((c, i) => ({ id: i + 1, text: c.label || "" }));
      const r = await evaluateTrade(mkEntries(o.want), mkEntries(o.give), settings);
      setFairness((f) => ({ ...f, [o.id]: r }));
    } catch { /* ignore */ } finally { setBusy(null); }
  }

  async function respond(o: MarketOfferDTO, action: "accept" | "decline" | "cancel") {
    setBusy(`${action}-${o.id}`);
    try {
      await marketRespond(o.id, action);
      if (action === "accept") {
        // Binders changed server-side — pull the fresh copy and remount.
        await cloudPull(cloudUserKey()).catch(() => {});
        window.dispatchEvent(new CustomEvent("cloud-synced"));
      }
      await loadOffers();
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't respond.");
    } finally { setBusy(null); }
  }

  const giveCards = mine.filter((c) => give.has(c.id));
  const wantCards = their?.cards.filter((c) => want.has(c.id)) || [];
  const giveTotal = giveCards.reduce((s, c) => s + c.value, 0);
  const wantTotal = wantCards.reduce((s, c) => s + c.value, 0);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
  };

  const fairPill = (f: string) => {
    if (f === "fair") return <span className="pill blue">{t("Fair")}</span>;
    if (f === "favors_you") return <span className="pill green">{t("Good for you")}</span>;
    if (f === "favors_them") return <span className="pill red">{t("They gain more")}</span>;
    return null;
  };

  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{t("Trade marketplace")}</h2>
        <div className="auth-tabs">
          <button className={tab === "find" ? "active" : ""} onClick={() => setTab("find")}>{t("Find a trader")}</button>
          <button className={tab === "offers" ? "active" : ""} onClick={() => { setTab("offers"); loadOffers(); }}>
            {t("Requests")}{offers?.incoming.some((o) => o.status === "pending") ? " 🔴" : ""}
          </button>
        </div>
      </div>

      {tab === "find" && (
        <>
          <div className="card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text" value={uname} placeholder={t("Enter a collector's username")}
                autoCapitalize="none" autoCorrect="off"
                onChange={(e) => setUname(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button className="btn" onClick={lookup} disabled={looking || !uname.trim()}>
                {looking ? <><span className="spinner" />{t("Looking…")}</> : t("Look up")}
              </button>
            </div>
            {lookErr && <div className="error-box" style={{ marginTop: 10 }}>{lookErr}</div>}
            {sent && <div className="ok-box" style={{ marginTop: 10 }}>✅ {t("Offer sent to")} {sent}!</div>}
          </div>

          {their && (
            <>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>{their.display}{t("'s binder — pick what you WANT")}</h3>
                {their.cards.length === 0 ? (
                  <p className="muted">{t("This collector's binder is empty.")}</p>
                ) : (
                  <div className="market-grid">
                    {their.cards.map((c) => (
                      <CardTile key={c.id} c={c} on={want.has(c.id)} onClick={() => toggle(want, setWant, c.id)} />
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>{t("Your binder — pick what you'll GIVE")}</h3>
                {mine.length === 0 ? (
                  <p className="muted">{t("Your binder is empty — scan and save some cards first.")}</p>
                ) : (
                  <div className="market-grid">
                    {mine.map((c) => (
                      <CardTile key={c.id} c={c} on={give.has(c.id)} onClick={() => toggle(give, setGive, c.id)} />
                    ))}
                  </div>
                )}
              </div>

              <div className="card market-summary">
                <div>
                  <div className="muted" style={{ fontSize: 13 }}>{t("You give")} · {money(giveTotal, settings.currency)}</div>
                  <div>{giveCards.map((c) => c.label).join(", ") || "—"}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("You get")} · {money(wantTotal, settings.currency)}</div>
                  <div>{wantCards.map((c) => c.label).join(", ") || "—"}</div>
                </div>
                <button className="btn" onClick={send} disabled={sending || !giveCards.length || !wantCards.length}>
                  {sending ? <><span className="spinner" />{t("Sending…")}</> : `📤 ${t("Send offer")}`}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === "offers" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>📥 {t("Incoming requests")}</h3>
            {!offers?.incoming.length ? (
              <p className="muted">{t("No incoming offers yet.")}</p>
            ) : offers.incoming.map((o) => {
              const f = fairness[o.id];
              const pending = o.status === "pending";
              const lbl = (arr: unknown[]) => (arr as { label?: string }[]).map((c) => c.label).join(", ");
              return (
                <div className="trade-rec" key={o.id}>
                  <div className="name">{o.fromDisplay} {t("wants to trade")}</div>
                  <div className="sub">📥 {t("You receive")}: {lbl(o.give)}</div>
                  <div className="sub">📤 {t("You give")}: {lbl(o.want)}</div>
                  {f && <div style={{ margin: "6px 0" }}>{fairPill(f.fairness)} <span className="muted" style={{ fontSize: 13 }}>{f.valueGapNote}</span></div>}
                  {!pending && <div className="muted" style={{ fontSize: 13 }}>{t("Status")}: {o.status}</div>}
                  {pending && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn ghost small" disabled={busy === `fair-${o.id}`} onClick={() => checkFair(o)}>
                        {busy === `fair-${o.id}` ? <span className="spinner" /> : "⚖"} {t("Check fairness")}
                      </button>
                      <button className="btn small" disabled={busy === `accept-${o.id}`} onClick={() => respond(o, "accept")}>
                        ✅ {t("Accept")}
                      </button>
                      <button className="btn ghost small" disabled={busy === `decline-${o.id}`} onClick={() => respond(o, "decline")}>
                        ✕ {t("Reject")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>📤 {t("Offers you sent")}</h3>
            {!offers?.outgoing.length ? (
              <p className="muted">{t("You haven't sent any offers.")}</p>
            ) : offers.outgoing.map((o) => {
              const lbl = (arr: unknown[]) => (arr as { label?: string }[]).map((c) => c.label).join(", ");
              return (
                <div className="trade-rec" key={o.id}>
                  <div className="name">{t("To")} {o.toDisplay} — <span className="muted">{o.status}</span></div>
                  <div className="sub">📤 {t("You give")}: {lbl(o.give)}</div>
                  <div className="sub">📥 {t("You get")}: {lbl(o.want)}</div>
                  {o.status === "pending" && (
                    <button className="btn ghost small" style={{ marginTop: 8 }} disabled={busy === `cancel-${o.id}`} onClick={() => respond(o, "cancel")}>
                      🗑 {t("Cancel")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
