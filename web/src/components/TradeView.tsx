import { useRef, useState } from "react";
import type { Settings, TradeResult, AskResult, CardEntry, SavedCard, WishItem, LaterItem } from "../types";
import { evaluateTrade, suggestAsks, suggestOffer } from "../api";
import { describeCard } from "../utils";
import { useT } from "../translator";
import CameraModal from "./CameraModal";
import BinderPicker from "./BinderPicker";

let nextId = 1;
const newEntry = (): CardEntry => ({ id: nextId++, text: "" });

function fairnessPill(f: string, t: (s: string) => string) {
  switch (f) {
    case "fair": return <span className="pill blue">{t("Fair — roughly even")}</span>;
    case "favors_you": return <span className="pill green">{t("Good for you — you gain")}</span>;
    case "favors_them": return <span className="pill red">{t("Bad for you — you give more")}</span>;
    case "lopsided": return <span className="pill red">{t("Lopsided")}</span>;
    default: return <span className="pill">{f}</span>;
  }
}

function likelihoodPill(l: string) {
  const t = l.toLowerCase();
  if (t.includes("high")) return <span className="pill green">{l}</span>;
  if (t.includes("stretch") || t.includes("low")) return <span className="pill red">{l}</span>;
  return <span className="pill blue">{l}</span>;
}

/** One editable card row: a text field plus an optional photo (camera/upload). */
function CardRow({
  entry,
  index,
  placeholder,
  onChange,
  onRemove,
  canRemove,
  onFromBinder,
  onFromWishlist,
}: {
  entry: CardEntry;
  index: number;
  placeholder: string;
  onChange: (e: CardEntry) => void;
  onRemove: () => void;
  canRemove: boolean;
  onFromBinder?: () => void;
  onFromWishlist?: () => void;
}) {
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => onChange({ ...entry, dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  return (
    <div className="card-row">
      {entry.dataUrl ? (
        <img className="thumb" src={entry.dataUrl} alt={`card ${index + 1}`} />
      ) : (
        <div className="thumb placeholder">{index + 1}</div>
      )}
      <div style={{ flex: 1 }}>
        <input
          type="text"
          value={entry.text}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...entry, text: e.target.value })}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <button className="btn ghost small" onClick={() => setShowCamera(true)}>
            📸 {t(entry.dataUrl ? "Retake" : "Photo")}
          </button>
          <button className="btn ghost small" onClick={() => fileRef.current?.click()}>{t("Upload")}</button>
          {onFromBinder && (
            <button className="btn ghost small" onClick={onFromBinder}>📒 {t("From binder")}</button>
          )}
          {onFromWishlist && (
            <button className="btn ghost small" onClick={onFromWishlist}>♡ {t("From wishlist")}</button>
          )}
          {entry.dataUrl && (
            <button className="btn ghost small" onClick={() => onChange({ ...entry, dataUrl: undefined })}>
              {t("Remove photo")}
            </button>
          )}
          {canRemove && (
            <button className="btn ghost small" onClick={onRemove} style={{ marginLeft: "auto" }}>
              ✕ {t("Remove card")}
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
      {showCamera && (
        <CameraModal
          onCapture={(d) => onChange({ ...entry, dataUrl: d })}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}

function Side({
  title,
  hint,
  entries,
  setEntries,
  placeholder,
  hasBinder,
  onFromBinder,
  hasWishlist,
  onFromWishlist,
}: {
  title: string;
  hint: string;
  entries: CardEntry[];
  setEntries: (e: CardEntry[]) => void;
  placeholder: string;
  hasBinder: boolean;
  onFromBinder: (entryId: number) => void;
  hasWishlist?: boolean;
  onFromWishlist?: (entryId: number) => void;
}) {
  const t = useT();
  function update(id: number, e: CardEntry) {
    setEntries(entries.map((x) => (x.id === id ? e : x)));
  }
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{hint}</p>
      {entries.map((entry, i) => (
        <CardRow
          key={entry.id}
          entry={entry}
          index={i}
          placeholder={placeholder}
          canRemove={entries.length > 1}
          onChange={(e) => update(entry.id, e)}
          onRemove={() => setEntries(entries.filter((x) => x.id !== entry.id))}
          onFromBinder={hasBinder ? () => onFromBinder(entry.id) : undefined}
          onFromWishlist={hasWishlist && onFromWishlist ? () => onFromWishlist(entry.id) : undefined}
        />
      ))}
      <button className="btn secondary small" onClick={() => setEntries([...entries, newEntry()])}>
        + {t("Add another card")}
      </button>
    </div>
  );
}

interface TradeProps {
  settings: Settings;
  saved: SavedCard[];
  wishlist: WishItem[];
  onTrade: () => void;
  onWishAll?: (texts: string[]) => void;
  onSaveLater: (item: Omit<LaterItem, "id" | "savedAt">) => void;
}

export default function TradeView({ settings, saved, wishlist, onTrade, onWishAll, onSaveLater }: TradeProps) {
  const [yourSide, setYourSide] = useState<CardEntry[]>([newEntry()]);
  const [theirSide, setTheirSide] = useState<CardEntry[]>([newEntry()]);
  const [trade, setTrade] = useState<TradeResult | null>(null);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [offer, setOffer] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState<"" | "fair" | "ask" | "offer">("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ side: "your" | "their"; id: number } | null>(null);
  const [pickingWish, setPickingWish] = useState<number | null>(null);
  const t = useT();

  function applyPick(card: SavedCard) {
    if (!picking) return;
    const { side, id } = picking;
    const setList = side === "your" ? setYourSide : setTheirSide;
    const text = describeCard(card.result);
    setList((prev) =>
      prev.map((e) => (e.id === id ? { ...e, text, dataUrl: card.thumbnail || e.dataUrl } : e))
    );
    setPicking(null);
  }

  function applyWishPick(item: WishItem) {
    if (pickingWish == null) return;
    const text = item.result ? describeCard(item.result) : item.text;
    setTheirSide((prev) => prev.map((e) => (e.id === pickingWish ? { ...e, text } : e)));
    setPickingWish(null);
  }

  const hasGiving = yourSide.some((e) => e.text.trim() || e.dataUrl);
  const hasReceiving = theirSide.some((e) => e.text.trim() || e.dataUrl);
  const givingText = yourSide.map((e) => e.text.trim()).filter(Boolean).join(" + ");
  const receivingText = theirSide.map((e) => e.text.trim()).filter(Boolean).join(" + ");

  function reset() {
    setTrade(null);
    setAsk(null);
    setOffer(null);
    setError(null);
  }

  async function checkFair() {
    setLoading("fair");
    reset();
    try {
      setTrade(await evaluateTrade(yourSide, theirSide, settings));
      onTrade();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade check failed.");
    } finally {
      setLoading("");
    }
  }

  async function whatToAsk() {
    setLoading("ask");
    reset();
    try {
      setAsk(await suggestAsks(yourSide, settings));
      onTrade();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed.");
    } finally {
      setLoading("");
    }
  }

  async function whoToGive() {
    setLoading("offer");
    reset();
    try {
      const owned = saved.map((s) => describeCard(s.result));
      setOffer(await suggestOffer(theirSide, owned, settings));
      onTrade();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed.");
    } finally {
      setLoading("");
    }
  }

  return (
    <div>
      <div className="card">
        <h2>{t("Trade tool")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Add the cards on each side — type them, snap a photo, or pull one from your binder. You can add multiple cards per side. Then check if a trade is fair, or ask what you should get back.")}
        </p>
      </div>

      <div className="grid2">
        <Side
          title={t("You give up")}
          hint={t("The card(s) you'd send.")}
          entries={yourSide}
          setEntries={setYourSide}
          placeholder="Describe a card you'd give"
          hasBinder={saved.length > 0}
          onFromBinder={(id) => setPicking({ side: "your", id })}
        />
        <Side
          title={t("You receive / want")}
          hint={t("Fill in for a fairness check, to ask what to give for it, or leave blank.")}
          entries={theirSide}
          setEntries={setTheirSide}
          placeholder="Describe a card you'd get"
          hasBinder={saved.length > 0}
          onFromBinder={(id) => setPicking({ side: "their", id })}
          hasWishlist={wishlist.length > 0}
          onFromWishlist={(id) => setPickingWish(id)}
        />
      </div>

      {picking && (
        <BinderPicker saved={saved} onPick={applyPick} onClose={() => setPicking(null)} />
      )}

      {pickingWish != null && (
        <div className="backdrop" onClick={() => setPickingWish(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(420px,92vw)", maxHeight: "70vh", overflow: "auto", zIndex: 50 }}>
            <h3 style={{ marginTop: 0 }}>♡ {t("Pick from wishlist")}</h3>
            {wishlist.length === 0 ? (
              <p className="muted">{t("Your wishlist is empty.")}</p>
            ) : (
              wishlist.map((w) => (
                <button key={w.id} className="picker-row" onClick={() => applyWishPick(w)} style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}>
                  {w.result?.player || w.text}
                </button>
              ))
            )}
            <button className="btn ghost small" onClick={() => setPickingWish(null)}>{t("Cancel")}</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={checkFair} disabled={!!loading || !hasGiving || !hasReceiving}>
            {loading === "fair" ? <><span className="spinner" />{t("Evaluating…")}</> : t("Is this fair?")}
          </button>
          <button className="btn secondary" onClick={whatToAsk} disabled={!!loading || !hasGiving}>
            {loading === "ask" ? <><span className="spinner" />{t("Thinking…")}</> : t("What should I ask for?")}
          </button>
          <button className="btn secondary" onClick={whoToGive} disabled={!!loading || !hasReceiving}>
            {loading === "offer" ? <><span className="spinner" />{t("Thinking…")}</> : t("Who should I give?")}
          </button>
        </div>
        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {trade && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {fairnessPill(trade.fairness, t)}
              <h2 style={{ margin: 0 }}>{trade.verdict}</h2>
            </div>
            <button
              className="btn ghost small"
              onClick={() => onSaveLater({ target: receivingText || trade.verdict, give: givingText ? [givingText] : [] })}
            >
              🔖 {t("Save for later")}
            </button>
          </div>
          <div className="grid2" style={{ marginTop: 14 }}>
            <div>
              <h3>{t("Your side")}</h3>
              <div className="value-big" style={{ fontSize: 22 }}>
                {settings.currency} {trade.yourSide.valueLow}–{trade.yourSide.valueHigh}
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{trade.yourSide.notes}</p>
            </div>
            <div>
              <h3>{t("Their side")}</h3>
              <div className="value-big" style={{ fontSize: 22 }}>
                {settings.currency} {trade.theirSide.valueLow}–{trade.theirSide.valueHigh}
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{trade.theirSide.notes}</p>
            </div>
          </div>
          <p style={{ fontWeight: 600 }}>{trade.valueGapNote}</p>
          <p>{trade.reasoning}</p>
          {trade.suggestions.length > 0 && (
            <>
              <h3>{t("How to even it out")}</h3>
              <ul style={{ marginTop: 0 }}>
                {trade.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {ask && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ marginBottom: 4 }}>{t("What to ask for")}</h2>
            {onWishAll && ask.targets.length > 0 && (
              <button
                className="btn ghost small"
                onClick={() => onWishAll(ask.targets.map((x) => `${x.player} ${x.cardSuggestion}`))}
              >
                ♡ {t("Add all to wishlist")}
              </button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>{ask.givingValueNote}</p>
          {ask.targets.map((x, i) => (
            <div className="trade-rec" key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div className="name">{x.player}</div>
                {likelihoodPill(x.likelihood)}
              </div>
              <div className="sub">
                {x.cardSuggestion}
                {x.estimatedValue ? ` · ${x.estimatedValue}` : ""}
              </div>
              <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{x.reason}</div>
              <button
                className="btn ghost small"
                style={{ marginTop: 6 }}
                onClick={() => onSaveLater({ target: `${x.player} ${x.cardSuggestion}`.trim(), give: givingText ? [givingText] : [] })}
              >
                🔖 {t("Save for later")}
              </button>
            </div>
          ))}
          {ask.note && <p className="muted" style={{ fontSize: 14 }}>{ask.note}</p>}
        </div>
      )}

      {offer && (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>{t("What to give")}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{offer.givingValueNote}</p>
          {offer.targets.map((x, i) => (
            <div className="trade-rec" key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div className="name">{x.player}</div>
                {likelihoodPill(x.likelihood)}
              </div>
              <div className="sub">
                {x.cardSuggestion}
                {x.estimatedValue ? ` · ${x.estimatedValue}` : ""}
              </div>
              <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{x.reason}</div>
              <button
                className="btn ghost small"
                style={{ marginTop: 6 }}
                onClick={() => onSaveLater({ target: receivingText || x.player, give: x.cardSuggestion ? [x.cardSuggestion] : [] })}
              >
                🔖 {t("Save for later")}
              </button>
            </div>
          ))}
          {offer.note && <p className="muted" style={{ fontSize: 14 }}>{offer.note}</p>}
        </div>
      )}
    </div>
  );
}
