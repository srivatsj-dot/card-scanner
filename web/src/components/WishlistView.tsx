import { useState } from "react";
import type { WishItem } from "../types";
import { money } from "../utils";
import { useT } from "../translator";
import ResultCard from "./ResultCard";

interface Props {
  wishlist: WishItem[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  onAddToBinder: (item: WishItem) => void;
  onRefresh: () => void;
  refreshing: boolean;
  adding: boolean;
}

function ChangeBadge({ item }: { item: WishItem }) {
  const t = useT();
  if (item.previousMid == null || !item.result) return null;
  const now = item.result.estimatedValue.mid;
  const diff = now - item.previousMid;
  if (Math.abs(diff) < 0.5) return <span className="pill">{t("no change")}</span>;
  const up = diff > 0;
  return (
    <span className={`pill ${up ? "green" : "red"}`}>
      {up ? "▲" : "▼"} {money(Math.abs(diff), item.result.estimatedValue.currency)}
    </span>
  );
}

export default function WishlistView({ wishlist, onAdd, onRemove, onAddToBinder, onRefresh, refreshing, adding }: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  function add() {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  }

  const totalKnown = wishlist.filter((w) => w.result);
  const total = totalKnown.reduce((s, w) => s + (w.result!.estimatedValue.mid || 0), 0);
  const currency = totalKnown[0]?.result?.estimatedValue.currency || "USD";

  return (
    <div>
      <div className="card">
        <h2>{t("Wishlist")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Cards you want. Add one and we'll look up its current price; prices auto-update daily.")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={text}
            placeholder="e.g. 2018 Bowman Chrome Juan Soto auto, or Pikachu VMAX 188/185"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn" onClick={add} disabled={adding || !text.trim()}>
            {adding ? <><span className="spinner" />{t("Adding…")}</> : `+ ${t("Add")}`}
          </button>
        </div>
      </div>

      {wishlist.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>{t("Estimated cost to acquire all")}</span>
              <div className="value-big" style={{ fontSize: 22 }}>{money(total, currency)}</div>
            </div>
            <button className="btn secondary small" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? <><span className="spinner" />{t("Updating…")}</> : `↻ ${t("Refresh prices")}`}
            </button>
          </div>
        </div>
      )}

      {wishlist.map((w) => {
        const r = w.result;
        const open = openId === w.id;
        return (
          <div className="card" key={w.id}>
            <div className="binder-row">
              <div className="thumb placeholder">♡</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontWeight: 700, fontSize: 16 }}>
                  {r?.player || w.text}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {r ? [r.year, r.manufacturer, r.setName].filter(Boolean).join(" · ") : t("Looking up…")}
                </div>
                <div style={{ marginTop: 4 }}>
                  {r?.sport && <span className="pill">{r.sport}</span>}
                  <ChangeBadge item={w} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {r && (
                  <div className="value-big" style={{ fontSize: 20 }}>
                    {money(r.estimatedValue.mid, r.estimatedValue.currency)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {r && (
                    <button className="btn ghost small" onClick={() => setOpenId(open ? null : w.id)}>
                      {open ? t("Hide") : t("View")}
                    </button>
                  )}
                  {r && (
                    <button
                      className="btn secondary small"
                      onClick={() => onAddToBinder(w)}
                      title={t("Got it — move to your binder")}
                    >
                      ★ {t("Got it → binder")}
                    </button>
                  )}
                  <button className="btn ghost small" onClick={() => onRemove(w.id)}>{t("Remove")}</button>
                </div>
              </div>
            </div>
            {open && r && <div style={{ marginTop: 14 }}><ResultCard result={r} /></div>}
          </div>
        );
      })}
    </div>
  );
}
