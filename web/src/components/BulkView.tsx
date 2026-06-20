import { useRef, useState } from "react";
import type { ScanResult, Settings, BulkCard } from "../types";
import { bulkScan } from "../api";
import { makeThumbnail, money, sleep, bulkCardToResult } from "../utils";
import { useT } from "../translator";
import CameraModal from "./CameraModal";

interface Props {
  settings: Settings;
  onSave: (result: ScanResult, frontDataUrl: string | undefined) => void;
}

interface Row {
  id: number;
  dataUrl: string;
  status: "pending" | "scanning" | "done" | "error";
  cards?: BulkCard[];
  saved: number[]; // indices of cards already saved to the binder
  error?: string;
}

let rid = 1;

export default function BulkView({ settings, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  function addImage(dataUrl: string) {
    setRows((prev) => [...prev, { id: rid++, dataUrl, status: "pending", saved: [] }]);
  }
  function handleFiles(files: FileList) {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => addImage(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  function patch(id: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function scanAll() {
    setRunning(true);
    // One call per photo (each photo may hold several cards). Default skips
    // grounding so a stack of photos doesn't trip the free tier; "accurate mode"
    // turns live verification on. Rate-limited photos back off and retry.
    const fastSettings = accurate ? settings : { ...settings, liveData: false };
    const pending = rows.filter((r) => r.status === "pending" || r.status === "error");
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      patch(row.id, { status: "scanning", error: undefined });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { cards } = await bulkScan(row.dataUrl, fastSettings);
          patch(row.id, { status: "done", cards: cards || [] });
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Scan failed.";
          const rateLimited = msg.toLowerCase().includes("rate limit");
          if (rateLimited && attempt < 2) {
            patch(row.id, { status: "scanning", error: t("Rate limited — waiting, then retrying…") });
            await sleep(8000 * (attempt + 1));
            continue;
          }
          patch(row.id, { status: "error", error: msg });
          break;
        }
      }
      if (i < pending.length - 1) await sleep(2000);
    }
    setRunning(false);
  }

  async function saveCard(row: Row, idx: number) {
    const card = row.cards?.[idx];
    if (!card || row.saved.includes(idx)) return;
    const thumb = await makeThumbnail(row.dataUrl);
    onSave(bulkCardToResult(card), thumb);
    patch(row.id, { saved: [...row.saved, idx] });
  }

  async function saveAll() {
    for (const row of rows) {
      if (!row.cards) continue;
      for (let idx = 0; idx < row.cards.length; idx++) {
        if (row.cards[idx].identified && !row.saved.includes(idx)) await saveCard(row, idx);
      }
    }
  }

  const allCards = rows.flatMap((r) => (r.cards || []).filter((c) => c.identified));
  const foundCount = allCards.length;
  const total = allCards.reduce((s, c) => s + (c.estimatedValue.mid || 0), 0);
  const currency = allCards[0]?.estimatedValue.currency || settings.currency;

  function cardLine(c: BulkCard): string {
    return [c.year, c.manufacturer, c.setName, c.cardNumber ? `#${c.cardNumber}` : ""]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <div>
      <div className="card">
        <h2>{t("Bulk scan")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Snap or upload a photo with several cards in it — a stack, a spread, or a binder page — and it identifies every card it can see at once. For the sharpest single-card appraisal, use the Scan tab.")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn secondary" onClick={() => setShowCamera(true)} disabled={running}>📸 {t("Add photo")}</button>
          <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={running}>{t("Upload photos")}</button>
          {rows.length > 0 && (
            <button className="btn" onClick={scanAll} disabled={running}>
              {running ? <><span className="spinner" />{t("Scanning…")}</> : `${t("Scan all")} (${rows.filter(r => r.status !== "done").length})`}
            </button>
          )}
          {rows.length > 0 && (
            <button className="btn ghost" onClick={() => setRows([])} disabled={running}>{t("Clear")}</button>
          )}
        </div>
        <label className="toggle" style={{ marginTop: 12, marginBottom: 0 }}>
          <input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} disabled={running} />
          {t("Accurate mode — verify with live data (slower, uses more quota)")}
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {foundCount > 0 && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <span className="muted" style={{ fontSize: 12 }}>{foundCount} {t("cards found · estimated total")}</span>
            <div className="value-big" style={{ fontSize: 22 }}>{money(total, currency)}</div>
          </div>
          <button className="btn" onClick={saveAll} disabled={running}>★ {t("Save all to binder")}</button>
        </div>
      )}

      {rows.map((row) => (
        <div className="card" key={row.id}>
          <div className="binder-row" style={{ alignItems: "flex-start" }}>
            <img className="thumb" src={row.dataUrl} alt="cards" />
            <div style={{ flex: 1, minWidth: 0 }}>
              {row.status === "scanning" && <div className="muted"><span className="spinner" />{row.error || t("Scanning…")}</div>}
              {row.status === "pending" && <div className="muted">{t("Ready to scan")}</div>}
              {row.status === "error" && <div className="warn">{row.error}</div>}
              {row.status === "done" && (
                <>
                  {(!row.cards || row.cards.length === 0) && (
                    <div className="muted">{t("No cards found in this photo.")}</div>
                  )}
                  {row.cards && row.cards.length > 0 && (
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                      {row.cards.filter((c) => c.identified).length} {t("identified in this photo")}
                    </div>
                  )}
                  {row.cards?.map((c, idx) => (
                    <div key={idx} className="bulk-card">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {c.identified ? (
                          <>
                            <div style={{ fontWeight: 700 }}>{c.player || t("Unknown player")}</div>
                            <div className="muted" style={{ fontSize: 13 }}>{cardLine(c) || "—"}</div>
                            <div style={{ marginTop: 4 }}>
                              {c.sport && <span className="pill">{c.sport}</span>}
                              {c.parallel && <span className="pill gold">{c.parallel}</span>}
                            </div>
                          </>
                        ) : (
                          <div className="muted">{t("Couldn't read this card")} — {c.note}</div>
                        )}
                      </div>
                      {c.identified && (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="value-big" style={{ fontSize: 17 }}>
                            {money(c.estimatedValue.mid, c.estimatedValue.currency)}
                          </div>
                          <button
                            className="btn ghost small"
                            style={{ marginTop: 6 }}
                            onClick={() => saveCard(row, idx)}
                            disabled={row.saved.includes(idx)}
                          >
                            {row.saved.includes(idx) ? t("✓ Saved") : t("★ Save")}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
            <button className="btn ghost small" onClick={() => setRows((p) => p.filter((r) => r.id !== row.id))} disabled={running}>
              {t("Remove")}
            </button>
          </div>
        </div>
      ))}

      {showCamera && <CameraModal onCapture={addImage} onClose={() => setShowCamera(false)} />}
    </div>
  );
}
