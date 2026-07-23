import { useMemo, useRef, useState } from "react";
import type { SavedCard } from "../types";
import { money } from "../utils";
import { useT } from "../translator";
import ResultCard from "./ResultCard";
import Sparkline from "./Sparkline";
import CameraModal from "./CameraModal";

interface Props {
  saved: SavedCard[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onConditionCheck: (id: string, dataUrl: string) => Promise<void>;
  onSetPhoto: (id: string, dataUrl: string) => void;
  onToggleFlag: (id: string, flag: "favorite" | "notNeeded") => void;
  mode: "list" | "grid" | "pages";
  onModeChange: (m: "list" | "grid" | "pages") => void;
}

/** Condition history, newest first, flagging flaws new since the prior check. */
function ConditionHistory({ log }: { log: NonNullable<SavedCard["conditionLog"]> }) {
  const t = useT();
  const asc = [...log].sort((a, b) => a.t - b.t);
  const rows = asc.map((e, i) => ({ ...e, isNew: (f: string) => i > 0 && !asc[i - 1].flaws.includes(f) }));
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{t("Condition history")}</h3>
      {rows.slice().reverse().map((e, i) => (
        <div key={i} style={{ padding: "6px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{e.grade}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{new Date(e.t).toLocaleDateString()}</span>
          </div>
          {e.flaws.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {e.flaws.map((f, j) => (
                <li key={j} style={{ fontSize: 13 }} className={e.isNew(f) ? "warn" : "muted"}>
                  {f}{e.isNew(f) ? ` — ${t("new")}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

type Sort = "recent" | "value" | "player" | "year" | "sport";

function ChangeBadge({ card }: { card: SavedCard }) {
  if (card.previousMid == null) return null;
  const now = card.result.estimatedValue.mid;
  const diff = now - card.previousMid;
  if (Math.abs(diff) < 0.5) return <span className="pill">no change</span>;
  const up = diff > 0;
  return (
    <span className={`pill ${up ? "green" : "red"}`}>
      {up ? "▲" : "▼"} {money(Math.abs(diff), card.result.estimatedValue.currency)}
    </span>
  );
}

export default function BinderView({ saved, onRemove, onClear, onRefresh, refreshing, onConditionCheck, onSetPhoto, onToggleFlag, mode, onModeChange }: Props) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null); // grid/pages card detail modal
  const [page, setPage] = useState(0); // current spread in "pages" (real binder) mode
  const [sort, setSort] = useState<Sort>("recent");
  const [sportFilter, setSportFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [camFor, setCamFor] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);

  function uploadPhoto(id: string) {
    uploadTargetRef.current = id;
    photoInputRef.current?.click();
  }

  const sports = useMemo(() => {
    const set = new Set<string>();
    saved.forEach((s) => s.result.sport && set.add(s.result.sport));
    return ["All", ...Array.from(set).sort()];
  }, [saved]);

  const view = useMemo(() => {
    let list = saved.slice();
    if (sportFilter !== "All") list = list.filter((s) => s.result.sport === sportFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => {
        const r = s.result;
        return [r.player, r.team, r.setName, r.manufacturer, r.year]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
    }
    const num = (v: string | null) => parseInt((v || "").replace(/\D/g, ""), 10) || 0;
    switch (sort) {
      case "value": list.sort((a, b) => b.result.estimatedValue.mid - a.result.estimatedValue.mid); break;
      case "player": list.sort((a, b) => (a.result.player || "").localeCompare(b.result.player || "")); break;
      case "year": list.sort((a, b) => num(b.result.year) - num(a.result.year)); break;
      case "sport": list.sort((a, b) => (a.result.sport || "").localeCompare(b.result.sport || "")); break;
      default: list.sort((a, b) => b.savedAt - a.savedAt);
    }
    return list;
  }, [saved, sort, sportFilter, query]);

  if (saved.length === 0) {
    return (
      <div className="card">
        <h2>{t("Your binder")}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          No saved cards yet. Scan or search a card and tap <strong>★ Save to binder</strong> to keep
          it here with a running total value that auto-updates daily.
        </p>
      </div>
    );
  }

  const currency = saved[0]?.result.estimatedValue.currency || "USD";
  const total = view.reduce((sum, s) => sum + (s.result.estimatedValue.mid || 0), 0);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{t("Your binder")}</h2>
          <div style={{ textAlign: "right" }}>
            <div className="value-big">{money(total, currency)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {view.length} of {saved.length} card{saved.length > 1 ? "s" : ""} · estimated total
            </div>
          </div>
        </div>

        <div className="binder-controls">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recently added</option>
            <option value="value">Most valuable</option>
            <option value="player">Player A–Z</option>
            <option value="year">Year (newest)</option>
            <option value="sport">Type / sport</option>
          </select>
          <select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)}>
            {sports.map((s) => <option key={s} value={s}>{s === "All" ? "All types" : s}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search binder…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button className="btn secondary small" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <><span className="spinner" />Updating…</> : `↻ ${t("Refresh prices")}`}
          </button>
        </div>
        <div className="auth-tabs" style={{ marginTop: 10 }}>
          <button className={mode === "list" ? "active" : ""} onClick={() => onModeChange("list")}>☰ {t("List")}</button>
          <button className={mode === "grid" ? "active" : ""} onClick={() => onModeChange("grid")}>▦ {t("Grid")}</button>
          <button className={mode === "pages" ? "active" : ""} onClick={() => { onModeChange("pages"); setPage(0); }}>📖 {t("Binder")}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 2px 0" }}>
          Prices auto-update once a day. ▲/▼ shows the change since the last update.
        </p>
      </div>

      {mode === "grid" && (
        <div className="card">
          <div className="binder-gallery">
            {view.map((s) => (
              <button key={s.id} className="gallery-card" onClick={() => setDetailId(s.id)} title={s.result.player || "card"}>
                {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div className="gallery-ph">🃏</div>}
                {s.favorite && <span className="gallery-star">⭐</span>}
                <div className="gallery-name">{s.result.player || "—"}</div>
                <div className="gallery-val">{money(s.result.estimatedValue.mid, s.result.estimatedValue.currency)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "pages" && (() => {
        const PER = 4;
        const pages = Math.max(1, Math.ceil(view.length / PER));
        const p = Math.min(page, pages - 1);
        const slice = view.slice(p * PER, p * PER + PER);
        return (
          <div className="card binder-book">
            <div className="binder-page" onClick={(e) => { if (e.target === e.currentTarget && p < pages - 1) setPage(p + 1); }}>
              {slice.map((s) => (
                <button key={s.id} className="pocket" onClick={() => setDetailId(s.id)}>
                  {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div className="gallery-ph">🃏</div>}
                  {s.favorite && <span className="gallery-star">⭐</span>}
                </button>
              ))}
              {Array.from({ length: PER - slice.length }).map((_, i) => <div key={`e${i}`} className="pocket empty" />)}
            </div>
            <div className="binder-book-nav">
              <button className="btn ghost small" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ {t("Previous page")}</button>
              <span className="muted" style={{ fontSize: 13 }}>{t("Page")} {p + 1} / {pages} · {t("tap the page to flip")}</span>
              <button className="btn ghost small" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>{t("Next page")} ›</button>
            </div>
          </div>
        );
      })()}

      {detailId && (() => {
        const s = view.find((x) => x.id === detailId);
        if (!s) return null;
        return (
          <div className="backdrop" onClick={() => setDetailId(null)}>
            <div className="card login-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 94vw)", maxHeight: "90vh" }}>
              <button className="modal-x" onClick={() => setDetailId(null)}>✕</button>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button className={`btn ghost small ${s.favorite ? "flag-on" : ""}`} onClick={() => onToggleFlag(s.id, "favorite")}>{s.favorite ? "⭐" : "☆"} {t("Favorite")}</button>
                <button className="btn ghost small" onClick={() => { onRemove(s.id); setDetailId(null); }}>{t("Remove")}</button>
              </div>
              <ResultCard result={s.result} />
            </div>
          </div>
        );
      })()}

      {mode === "list" && view.map((s) => {
        const r = s.result;
        const open = openId === s.id;
        return (
          <div className="card" key={s.id}>
            <div className="binder-row">
              {s.thumbnail ? (
                <img className="thumb" src={s.thumbnail} alt={r.player || "card"} />
              ) : (
                <div className="thumb placeholder">🖼️</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontWeight: 700, fontSize: 16 }}>{r.player || "Unknown card"}</div>
                <div className="muted" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 13 }}>
                  {[r.year, r.manufacturer, r.setName].filter(Boolean).join(" · ") || "—"}
                </div>
                <div style={{ marginTop: 4 }}>
                  {r.sport && <span className="pill">{r.sport}</span>}
                  {r.parallel && <span className="pill gold">{r.parallel}</span>}
                  {s.favorite && <span className="pill gold">⭐ {t("Favorite")}</span>}
                  <ChangeBadge card={s} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="value-big" style={{ fontSize: 20 }}>
                  {money(r.estimatedValue.mid, r.estimatedValue.currency)}
                </div>
                {s.history && s.history.length >= 2 && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <Sparkline points={s.history.map((h) => h.mid)} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {!s.thumbnail && (
                    <>
                      <button className="btn ghost small" onClick={() => setPhotoFor(s.id)} title={t("Camera")}>📷 {t("Add photo")}</button>
                      <button className="btn ghost small" onClick={() => uploadPhoto(s.id)} title={t("Upload")}>⬆</button>
                    </>
                  )}
                  <button
                    className={`btn ghost small ${s.favorite ? "flag-on" : ""}`}
                    onClick={() => onToggleFlag(s.id, "favorite")}
                    title={t("Favorite — protect from trade suggestions")}
                  >
                    {s.favorite ? "⭐" : "☆"}
                  </button>
                  <button className="btn ghost small" onClick={() => setCamFor(s.id)} disabled={checking === s.id} title={t("Re-scan to log condition")}>
                    {checking === s.id ? <><span className="spinner" />{t("Checking…")}</> : `🩺 ${t("Condition")}`}
                  </button>
                  <button className="btn ghost small" onClick={() => setOpenId(open ? null : s.id)}>
                    {open ? t("Hide") : t("View")}
                  </button>
                  <button className="btn ghost small" onClick={() => onRemove(s.id)}>{t("Remove")}</button>
                </div>
              </div>
            </div>
            {s.conditionLog && s.conditionLog.length > 0 && <ConditionHistory log={s.conditionLog} />}
            {open && <div style={{ marginTop: 14 }}><ResultCard result={r} /></div>}
          </div>
        );
      })}

      {camFor && (
        <CameraModal
          onCapture={async (d) => {
            const id = camFor;
            setCamFor(null);
            setChecking(id);
            try { await onConditionCheck(id, d); } finally { setChecking(null); }
          }}
          onClose={() => setCamFor(null)}
        />
      )}

      {photoFor && (
        <CameraModal
          onCapture={(d) => { onSetPhoto(photoFor, d); setPhotoFor(null); }}
          onClose={() => setPhotoFor(null)}
        />
      )}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          const id = uploadTargetRef.current;
          if (f && id) {
            const reader = new FileReader();
            reader.onload = () => onSetPhoto(id, reader.result as string);
            reader.readAsDataURL(f);
          }
          e.target.value = "";
        }}
      />

      <div className="card" style={{ textAlign: "center" }}>
        <button className="btn ghost" onClick={onClear}>Clear binder</button>
      </div>
    </div>
  );
}
