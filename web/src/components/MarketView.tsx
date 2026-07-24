import { useEffect, useRef, useState } from "react";
import type { SavedCard, Settings, TradeResult } from "../types";
import { describeCard, money } from "../utils";
import { evaluateTrade } from "../api";
import {
  marketLookup, marketOffers, marketSendOffer, marketRespond, marketSearchCards,
  cloudPull, cloudUserKey, type MarketCardDTO, type MarketOfferDTO, type CardSearchHit,
  friendsList, friendRequest, friendRespond, friendRemove, type FriendUserDTO,
  chatThread, chatSend, type ChatMsgDTO,
} from "../cloud";
import { useT } from "../translator";
import GuestGate from "./GuestGate";
import ResultCard from "./ResultCard";

interface Props {
  saved: SavedCard[];
  settings: Settings;
  cloudOn: boolean;
  isGuest: boolean;
  onRequireLogin: () => void;
  prefillUser?: string | null; // auto-look-up this username on open (from People search)
  onPrefillDone?: () => void;
  onTradeEvent?: (evt: { type: "made" | "accepted" | "rejected"; cards?: number }) => void;
  myWishlist: string[]; // my wishlist labels, to green-outline their cards I want
}

// Turn one of my SavedCards into the lightweight shape the server stores/moves.
const toDTO = (c: SavedCard): MarketCardDTO => ({
  id: c.id,
  label: describeCard(c.result),
  sport: c.result.sport || "",
  value: c.result.estimatedValue?.mid || 0,
  currency: c.result.estimatedValue?.currency || "USD",
  thumb: c.thumbnail || "",
  favorite: c.favorite === true,
});

// Fuzzy: does a card label match anything on a wishlist (≥2 shared key tokens)?
function matchesAny(label: string, list: string[]): boolean {
  const tokens = label.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
  if (tokens.length < 2 || !list.length) return false;
  return list.some((w) => {
    const wl = w.toLowerCase();
    return tokens.filter((tok) => wl.includes(tok)).length >= 2;
  });
}

function CardTile({ c, on, outline, onClick, onInfo }: { c: MarketCardDTO; on: boolean; outline?: "red" | "yellow"; onClick: () => void; onInfo?: () => void }) {
  return (
    <div className="market-tile-wrap">
      <button className={`market-tile ${on ? "sel" : ""} ${outline ? `outline-${outline}` : ""}`} onClick={onClick} title={c.label}>
        {c.thumb ? <span className="cardframe market-pic"><img src={c.thumb} alt="" /></span> : <div className="market-tile-ph">🃏</div>}
        <div className="market-tile-label">{c.label}</div>
        <div className="market-tile-val">{money(c.value, c.currency)}</div>
      </button>
      {onInfo && (
        <button className="tile-info" title="Card info" onClick={(e) => { e.stopPropagation(); onInfo(); }}>ⓘ</button>
      )}
    </div>
  );
}

export default function MarketView({ saved, settings, cloudOn, isGuest, onRequireLogin, prefillUser, onPrefillDone, onTradeEvent, myWishlist }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"find" | "offers" | "friends">("find");
  // Friends
  const [friends, setFriends] = useState<{ friends: FriendUserDTO[]; incoming: FriendUserDTO[]; outgoing: FriendUserDTO[] } | null>(null);
  const [friendName, setFriendName] = useState("");
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
  const [friendFilter, setFriendFilter] = useState(""); // search within your friends list
  // Chat — only exists during trading: tied to the current trade partner, shown
  // as a hideable panel on the right with a new-message toast.
  const [chatPartner, setChatPartner] = useState<{ username: string; display: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsgDTO[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const lastMsgId = useRef(0);
  const [uname, setUname] = useState("");
  // Find = card search across your friends' binders ("who has this card?").
  const [cardQuery, setCardQuery] = useState("");
  const [hits, setHits] = useState<CardSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [their, setTheir] = useState<{ display: string; username: string; cards: MarketCardDTO[]; wishlist: string[]; avatar?: string } | null>(null);
  const [infoCard, setInfoCard] = useState<MarketCardDTO | null>(null); // card-detail modal in the trade view
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [want, setWant] = useState<Set<string>>(new Set());
  const [give, setGive] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [counteringId, setCounteringId] = useState<string | null>(null); // incoming offer being countered
  const [buildFair, setBuildFair] = useState<TradeResult | null>(null); // fairness of the offer you're building
  const [offers, setOffers] = useState<{ incoming: MarketOfferDTO[]; outgoing: MarketOfferDTO[] } | null>(null);
  const [fairness, setFairness] = useState<Record<string, TradeResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const mine = saved.map(toDTO);

  async function loadOffers() {
    try { setOffers(await marketOffers()); } catch { /* ignore */ }
  }
  async function loadFriends() {
    try { setFriends(await friendsList()); } catch { /* ignore */ }
  }
  useEffect(() => { if (cloudOn && !isGuest) { loadOffers(); loadFriends(); } }, [cloudOn, isGuest]);

  // Deep-link from People search: auto-look-up a username on open.
  useEffect(() => {
    if (!prefillUser || !cloudOn || isGuest) return;
    setUname(prefillUser);
    setTab("find");
    lookup(prefillUser);
    onPrefillDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillUser]);

  // Poll the current conversation every 4s so replies show up live. When a new
  // message lands and the panel is closed, badge it and toast bottom-right.
  useEffect(() => {
    if (!chatPartner) return;
    let cancelled = false;
    const pull = () => chatThread(chatPartner.username).then((r) => {
      if (cancelled) return;
      const maxId = r.messages.reduce((m, x) => Math.max(m, x.id), 0);
      const incoming = r.messages.filter((x) => !x.mine && x.id > lastMsgId.current);
      setMsgs(r.messages);
      if (lastMsgId.current > 0 && incoming.length && !chatOpen) {
        setUnread((u) => u + incoming.length);
        setToast(`💬 ${chatPartner.display}: ${incoming[incoming.length - 1].body.slice(0, 40)}`);
        setTimeout(() => setToast(null), 5000);
      }
      lastMsgId.current = maxId;
    }).catch(() => {});
    pull();
    const iv = setInterval(pull, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [chatPartner, chatOpen]);

  function openChatWith(username: string, display: string) {
    setChatPartner({ username, display });
    setMsgs([]);
    lastMsgId.current = 0;
    setUnread(0);
    setChatOpen(true);
  }
  async function sendChat() {
    if (!chatPartner || !chatInput.trim()) return;
    const body = chatInput.trim();
    setChatInput("");
    try {
      await chatSend(chatPartner.username, body);
      const r = await chatThread(chatPartner.username);
      setMsgs(r.messages);
      lastMsgId.current = r.messages.reduce((m, x) => Math.max(m, x.id), 0);
    } catch { /* ignore */ }
  }
  async function addFriend() {
    const name = friendName.trim();
    if (!name) return;
    setFriendMsg(null);
    try {
      const r = await friendRequest(name);
      setFriendMsg(`✅ ${t("Friend request sent to")} ${r.display}`);
      setFriendName("");
      loadFriends();
    } catch (e) {
      setFriendMsg(e instanceof Error ? e.message : "Couldn't send request.");
    }
  }

  if (isGuest) return <GuestGate feature="Look up other collectors, browse their binder, and send trade offers." onLogin={onRequireLogin} />;
  if (!cloudOn) {
    return (
      <div className="card">
        <h2>{t("Trade")}</h2>
        <p className="muted">{t("Trading with other collectors needs cloud accounts, which aren't enabled on this server. Set DATABASE_URL to turn it on.")}</p>
      </div>
    );
  }

  async function searchCards(q?: string) {
    const query = (q ?? cardQuery).trim();
    if (query.length < 2) return;
    setSearching(true); setHits(null); setTheir(null); setLookErr(null);
    try {
      const r = await marketSearchCards(query);
      setHits(r.results);
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't search cards.");
    } finally { setSearching(false); }
  }

  async function lookup(name?: string) {
    const q = (name ?? uname).trim();
    if (!q) return;
    setLooking(true); setLookErr(null); setTheir(null); setWant(new Set()); setSent(null);
    try {
      const found = await marketLookup(q);
      setTheir(found);
      // You're now trading with them — enable chat (panel stays hidden until opened).
      if (!chatPartner || chatPartner.username !== found.username) {
        setChatPartner({ username: found.username, display: found.display });
        setMsgs([]); lastMsgId.current = 0; setUnread(0);
      }
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
      // A counter passes the original id so the server retires it as "countered"
      // (never "declined") and flags the new offer as a counter-offer.
      await marketSendOffer(their.username, giveCards, wantCards, counteringId || undefined);
      onTradeEvent?.({ type: "made" });
      if (counteringId) setCounteringId(null);
      setSent(their.display);
      setWant(new Set()); setGive(new Set());
      loadOffers();
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't send the offer.");
    } finally { setSending(false); }
  }

  // Counter an incoming offer: jump to the sender's binder to build a reply.
  // "Modify" prefills the same cards to tweak; "Trade back" starts fresh.
  // Sending the counter retires the original as "countered" (not declined).
  async function counter(o: MarketOfferDTO, prefill: boolean) {
    setCounteringId(o.id);
    setUname(o.fromUser);
    setTab("find");
    await lookup(o.fromUser);
    if (prefill) {
      setWant(new Set((o.give as { id: string }[]).map((c) => c.id))); // their cards I'd receive
      setGive(new Set((o.want as { id: string }[]).map((c) => c.id))); // my cards I'd give
    } else {
      setWant(new Set()); setGive(new Set());
    }
  }

  // Check fairness of the offer you're BUILDING (before sending): you give the
  // selected give-cards, you receive the selected want-cards.
  async function checkBuildFairness() {
    const giveList = mine.filter((c) => give.has(c.id));
    const wantList = their?.cards.filter((c) => want.has(c.id)) || [];
    if (!giveList.length || !wantList.length) return;
    setBusy("buildfair");
    try {
      const mk = (arr: { label: string }[]) => arr.map((c, i) => ({ id: i + 1, text: c.label }));
      setBuildFair(await evaluateTrade(mk(giveList), mk(wantList), settings));
    } catch { /* ignore */ } finally { setBusy(null); }
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
      if (action === "accept") onTradeEvent?.({ type: "accepted", cards: (o.give?.length || 0) + (o.want?.length || 0) });
      else if (action === "decline") onTradeEvent?.({ type: "rejected" });
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
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{t("Trade")}</h2>
        <div className="auth-tabs market-tabs">
          <button className={tab === "find" ? "active" : ""} onClick={() => setTab("find")}>{t("Find")}</button>
          <button className={tab === "offers" ? "active" : ""} onClick={() => { setTab("offers"); loadOffers(); }}>
            {t("Requests")}{offers?.incoming.some((o) => o.status === "pending") ? " 🔴" : ""}
          </button>
          <button className={tab === "friends" ? "active" : ""} onClick={() => { setTab("friends"); loadFriends(); }}>
            {t("Friends")}{friends?.incoming.length ? ` 🔴` : ""}
          </button>
        </div>
      </div>

      {tab === "find" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🔍 {t("Search for a card")}</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              {t("Find which of your friends has a card — e.g. \"Charizard\" or \"Jordan rookie\". To trade, tap a friend below.")}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text" value={cardQuery} placeholder={t("Card name, player, or set")}
                onChange={(e) => setCardQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchCards(); }}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button className="btn" onClick={() => searchCards()} disabled={searching || cardQuery.trim().length < 2}>
                {searching ? <><span className="spinner" />{t("Searching…")}</> : t("Search")}
              </button>
            </div>
            {lookErr && !their && <div className="error-box" style={{ marginTop: 10 }}>{lookErr}</div>}
            {sent && <div className="ok-box" style={{ marginTop: 10 }}>✅ {t("Offer sent to")} {sent}!</div>}
          </div>

          {/* Card-search results: friends who have a matching card. */}
          {hits && !their && (
            <div className="card">
              {hits.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  {t("None of your friends have a card matching that. Add more friends, or try different words.")}
                </p>
              ) : (
                <>
                  <h3 style={{ marginTop: 0 }}>{t("Friends who have it")}</h3>
                  {hits.map((h) => (
                    <div className="trade-rec" key={h.username}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div className="name">{h.avatar ? `${h.avatar} ` : ""}{h.display} <span className="muted" style={{ fontWeight: 400 }}>· {h.cards.length} {h.cards.length === 1 ? t("match") : t("matches")}</span></div>
                        <button className="btn small" onClick={() => lookup(h.username)}>🛒 {t("Trade")}</button>
                      </div>
                      <div className="sub" style={{ marginTop: 4 }}>{h.cards.map((c) => c.label).join(" · ")}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Trade with any friend directly (the full interactive trade lives here). */}
          {!their && !hits && !!friends?.friends.length && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("Trade with a friend")}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {friends.friends.map((u) => (
                  <button key={u.username} className="btn ghost small" onClick={() => lookup(u.username)}>🛒 {u.display}</button>
                ))}
              </div>
            </div>
          )}
          {!their && !hits && !friends?.friends.length && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                {t("Add friends in the Friends tab first — you can search their cards and trade with them here.")}
              </p>
            </div>
          )}

          {their && (
            <>
              <div className="card" style={{ paddingTop: 10, paddingBottom: 10 }}>
                <button className="btn ghost small" onClick={() => { setTheir(null); setWant(new Set()); setGive(new Set()); setCounteringId(null); }}>‹ {t("Back to search")}</button>
              </div>
              {counteringId && (
                <div className="card" style={{ borderColor: "var(--accent)" }}>
                  🔄 {t("Countering")} {their.display}{t("'s offer — adjust the cards below (swap a card, add one, or remove one) and send it back.")}
                  <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => { setCounteringId(null); setWant(new Set()); setGive(new Set()); }}>{t("Start over")}</button>
                </div>
              )}
              <div className="card">
                <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  {their.avatar && (
                    <span className="user-avatar" style={{ width: 26, height: 26, fontSize: 15 }}>
                      {/^(data:|https?:)/.test(their.avatar) ? <img src={their.avatar} alt="" /> : their.avatar}
                    </span>
                  )}
                  {their.display}{t("'s binder — pick what you WANT")}
                </h3>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  🟥 {t("outlined = on your wishlist")} · 🟨 {t("= one of their favorites")} · ⓘ {t("tap for card info")}
                </p>
                {their.cards.length === 0 ? (
                  <p className="muted">{t("This collector's binder is empty.")}</p>
                ) : (
                  <div className="market-grid">
                    {their.cards.map((c) => (
                      <CardTile
                        key={c.id} c={c} on={want.has(c.id)}
                        outline={matchesAny(c.label, myWishlist) ? "red" : c.favorite ? "yellow" : undefined}
                        onClick={() => toggle(want, setWant, c.id)}
                        onInfo={() => setInfoCard(c)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>{t("Your binder — pick what you'll GIVE")}</h3>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>🟥 {t("outlined = on their wishlist")}</p>
                {mine.length === 0 ? (
                  <p className="muted">{t("Your binder is empty — scan and save some cards first.")}</p>
                ) : (
                  <div className="market-grid">
                    {mine.map((c) => (
                      <CardTile
                        key={c.id} c={c} on={give.has(c.id)}
                        outline={matchesAny(c.label, their.wishlist) ? "red" : undefined}
                        onClick={() => toggle(give, setGive, c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="market-summary">
                  <div>
                    <div className="muted" style={{ fontSize: 13 }}>{t("You give")} · {money(giveTotal, settings.currency)}</div>
                    <div>{giveCards.map((c) => c.label).join(", ") || "—"}</div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("You get")} · {money(wantTotal, settings.currency)}</div>
                    <div>{wantCards.map((c) => c.label).join(", ") || "—"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn secondary" disabled={busy === "buildfair" || !giveCards.length || !wantCards.length} onClick={checkBuildFairness}>
                      {busy === "buildfair" ? <><span className="spinner" />{t("Checking…")}</> : `⚖️ ${t("Check fairness")}`}
                    </button>
                    <button className="btn" onClick={send} disabled={sending || !giveCards.length || !wantCards.length}>
                      {sending ? <><span className="spinner" />{t("Sending…")}</> : counteringId ? `🔄 ${t("Send counter-offer")}` : `📤 ${t("Send offer")}`}
                    </button>
                  </div>
                </div>
                {buildFair && (
                  <div style={{ marginTop: 10 }}>
                    {fairPill(buildFair.fairness)}{" "}
                    <span className="muted" style={{ fontSize: 14 }}>{buildFair.valueGapNote}</span>
                  </div>
                )}
                {lookErr && their && <div className="error-box" style={{ marginTop: 10 }}>{lookErr}</div>}
              </div>
            </>
          )}
        </>
      )}

      {tab === "offers" && (() => {
        // Only PENDING offers park here — once accepted/declined they leave the
        // list (the cards swap + a center popup is the record).
        const incoming = (offers?.incoming || []).filter((o) => o.status === "pending");
        const outgoing = (offers?.outgoing || []).filter((o) => o.status === "pending");
        return (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>📥 {t("Incoming requests")}</h3>
            {!incoming.length ? (
              <p className="muted">{t("No incoming offers yet.")}</p>
            ) : incoming.map((o) => {
              const f = fairness[o.id];
              const pending = o.status === "pending";
              const lbl = (arr: unknown[]) => (arr as { label?: string }[]).map((c) => c.label).join(", ");
              return (
                <div className="trade-rec" key={o.id}>
                  <div className="name">{o.counter ? `🔄 ${o.fromDisplay} ${t("sent a counter-offer")}` : `${o.fromDisplay} ${t("wants to trade")}`}</div>
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
                      <button className="btn ghost small" onClick={() => counter(o, true)}>✏️ {t("Modify")}</button>
                      <button className="btn ghost small" onClick={() => counter(o, false)}>🔄 {t("Trade back")}</button>
                      <button className="btn ghost small" onClick={() => openChatWith(o.fromUser, o.fromDisplay)}>💬 {t("Chat")}</button>
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
            <h3 style={{ marginTop: 0 }}>📤 {t("Waiting on a reply")}</h3>
            {!outgoing.length ? (
              <p className="muted">{t("No offers waiting for a reply.")}</p>
            ) : outgoing.map((o) => {
              const lbl = (arr: unknown[]) => (arr as { label?: string }[]).map((c) => c.label).join(", ");
              return (
                <div className="trade-rec" key={o.id}>
                  <div className="name">{t("To")} {o.toDisplay} — <span className="muted">{t("waiting")}</span></div>
                  <div className="sub">📤 {t("You give")}: {lbl(o.give)}</div>
                  <div className="sub">📥 {t("You get")}: {lbl(o.want)}</div>
                  <button className="btn ghost small" style={{ marginTop: 8 }} disabled={busy === `cancel-${o.id}`} onClick={() => respond(o, "cancel")}>
                    🗑 {t("Cancel")}
                  </button>
                </div>
              );
            })}
          </div>
        </>
        );
      })()}

      {tab === "friends" && (
        <>
          <div className="card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text" value={friendName} placeholder={t("Add a friend by username")}
                autoCapitalize="none" autoCorrect="off"
                onChange={(e) => setFriendName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addFriend(); }}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button className="btn" onClick={addFriend} disabled={!friendName.trim()}>{t("Add friend")}</button>
            </div>
            {friendMsg && <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>{friendMsg}</p>}
          </div>

          {!!friends?.incoming.length && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("Friend requests")}</h3>
              {friends.incoming.map((u) => (
                <div className="trade-rec" key={u.username} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="name">{u.display}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn small" onClick={() => friendRespond(u.username, true).then(loadFriends)}>✅ {t("Accept")}</button>
                    <button className="btn ghost small" onClick={() => friendRespond(u.username, false).then(loadFriends)}>✕ {t("Decline")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("Your friends")}</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{t("To trade with a friend, go to the Find tab.")}</p>
            {!friends?.friends.length ? (
              <p className="muted">{t("No friends yet — add someone by username above.")}</p>
            ) : (() => {
              const q = friendFilter.trim().toLowerCase();
              const list = q ? friends.friends.filter((u) => u.display.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)) : friends.friends;
              return (
                <>
                  {friends.friends.length > 4 && (
                    <input
                      type="text" value={friendFilter} placeholder={t("Search your friends…")}
                      onChange={(e) => setFriendFilter(e.target.value)}
                      style={{ width: "100%", marginBottom: 10 }}
                    />
                  )}
                  {!list.length ? (
                    <p className="muted">{t("No friends match that search.")}</p>
                  ) : list.map((u) => (
                    <div className="trade-rec" key={u.username} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div className="name">{u.display}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn ghost small" onClick={() => { setTab("find"); setHits(null); lookup(u.username); }}>🛒 {t("Trade")}</button>
                        <button className="btn ghost small" onClick={() => openChatWith(u.username, u.display)}>💬 {t("Message")}</button>
                        <button className="btn ghost small" onClick={() => friendRemove(u.username).then(loadFriends)}>{t("Remove")}</button>
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
            {!!friends?.outgoing.length && (
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                {t("Pending")}: {friends.outgoing.map((u) => u.display).join(", ")}
              </p>
            )}
          </div>
        </>
      )}

      {/* Tap ⓘ on one of their cards to see ALL of its info without selecting it. */}
      {infoCard && (
        <div className="backdrop" onClick={() => setInfoCard(null)}>
          <div className="card login-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(600px, 96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <button className="modal-x" onClick={() => setInfoCard(null)}>✕</button>
            {infoCard.detail ? (
              <>
                {infoCard.favorite && <div style={{ marginBottom: 8 }}><span className="pill gold">⭐ {t("Their favorite")}</span></div>}
                <ResultCard result={infoCard.detail} />
              </>
            ) : (
              <div style={{ textAlign: "center" }}>
                {infoCard.thumb
                  ? <img src={infoCard.thumb} alt="" style={{ width: "70%", maxWidth: 240, borderRadius: 10, margin: "6px auto 10px", display: "block" }} />
                  : <div style={{ fontSize: 60, margin: "10px 0" }}>🃏</div>}
                <h3 style={{ margin: "0 0 6px" }}>{infoCard.label}</h3>
                {infoCard.sport && <span className="pill">{infoCard.sport}</span>}
                {infoCard.favorite && <span className="pill gold">⭐ {t("Their favorite")}</span>}
                <div className="value-big" style={{ marginTop: 10 }}>{money(infoCard.value, infoCard.currency)}</div>
                <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{t("Estimated value")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat only exists while trading with someone: a hideable right-side panel. */}
      {chatPartner && (
        <>
          <button
            className="chat-arrow"
            onClick={() => { setChatOpen((o) => !o); setUnread(0); }}
            title={t("Chat with your trade partner")}
          >
            {chatOpen ? "›" : "‹"} 💬{unread > 0 ? <span className="chat-badge">{unread}</span> : null}
          </button>
          <div className={`chat-panel ${chatOpen ? "open" : ""}`}>
            <div className="chat-panel-head">
              <strong>{chatPartner.display}</strong>
              <button className="modal-x" style={{ position: "static" }} onClick={() => setChatOpen(false)}>✕</button>
            </div>
            <div className="chat-messages">
              {msgs.map((m) => (
                <div key={m.id} className={`chat-bubble ${m.mine ? "mine" : "theirs"}`}>{m.body}</div>
              ))}
              {!msgs.length && <p className="muted">{t("Say hi 👋 — chat about the trade.")}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text" value={chatInput} placeholder={t("Type a message…")}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={sendChat} disabled={!chatInput.trim()}>{t("Send")}</button>
            </div>
          </div>
        </>
      )}
      {toast && !chatOpen && (
        <button className="chat-toast" onClick={() => { setChatOpen(true); setUnread(0); setToast(null); }}>{toast}</button>
      )}
    </div>
  );
}
