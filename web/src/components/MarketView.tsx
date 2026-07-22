import { useEffect, useRef, useState } from "react";
import type { SavedCard, Settings, TradeResult } from "../types";
import { describeCard, money } from "../utils";
import { evaluateTrade } from "../api";
import {
  marketLookup, marketOffers, marketSendOffer, marketRespond,
  cloudPull, cloudUserKey, type MarketCardDTO, type MarketOfferDTO,
  friendsList, friendRequest, friendRespond, friendRemove, type FriendUserDTO,
  chatThread, chatSend, type ChatMsgDTO,
} from "../cloud";
import { useT } from "../translator";
import GuestGate from "./GuestGate";

interface Props {
  saved: SavedCard[];
  settings: Settings;
  cloudOn: boolean;
  isGuest: boolean;
  onRequireLogin: () => void;
  prefillUser?: string | null; // auto-look-up this username on open (from People search)
  onPrefillDone?: () => void;
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

export default function MarketView({ saved, settings, cloudOn, isGuest, onRequireLogin, prefillUser, onPrefillDone }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"find" | "offers" | "friends">("find");
  // Friends
  const [friends, setFriends] = useState<{ friends: FriendUserDTO[]; incoming: FriendUserDTO[]; outgoing: FriendUserDTO[] } | null>(null);
  const [friendName, setFriendName] = useState("");
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
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
  const [their, setTheir] = useState<{ display: string; username: string; cards: MarketCardDTO[] } | null>(null);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [want, setWant] = useState<Set<string>>(new Set());
  const [give, setGive] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [counteringId, setCounteringId] = useState<string | null>(null); // incoming offer being countered
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
      await marketSendOffer(their.username, giveCards, wantCards);
      // If this was a counter to an incoming offer, decline the original.
      if (counteringId) { await marketRespond(counteringId, "decline").catch(() => {}); setCounteringId(null); }
      setSent(their.display);
      setWant(new Set()); setGive(new Set());
      loadOffers();
    } catch (e) {
      setLookErr(e instanceof Error ? e.message : "Couldn't send the offer.");
    } finally { setSending(false); }
  }

  // Counter an incoming offer: jump to the sender's binder to build a reply.
  // "Modify" prefills the same cards to tweak; "Trade back" starts fresh.
  // Sending the counter declines the original.
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text" value={uname} placeholder={t("Enter a collector's username")}
                autoCapitalize="none" autoCorrect="off"
                onChange={(e) => setUname(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button className="btn" onClick={() => lookup()} disabled={looking || !uname.trim()}>
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
                  {sending ? <><span className="spinner" />{t("Sending…")}</> : counteringId ? `🔄 ${t("Send counter-offer")}` : `📤 ${t("Send offer")}`}
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
            {!friends?.friends.length ? (
              <p className="muted">{t("No friends yet — add someone by username above.")}</p>
            ) : friends.friends.map((u) => (
              <div className="trade-rec" key={u.username} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div className="name">{u.display}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="btn ghost small" onClick={() => { setUname(u.username); setTab("find"); lookup(); }}>🛒 {t("Trade")}</button>
                  <button className="btn ghost small" onClick={() => openChatWith(u.username, u.display)}>💬 {t("Message")}</button>
                  <button className="btn ghost small" onClick={() => friendRemove(u.username).then(loadFriends)}>{t("Remove")}</button>
                </div>
              </div>
            ))}
            {!!friends?.outgoing.length && (
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                {t("Pending")}: {friends.outgoing.map((u) => u.display).join(", ")}
              </p>
            )}
          </div>
        </>
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
