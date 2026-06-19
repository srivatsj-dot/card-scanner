import { useRef, useState } from "react";
import type { ScanResult, Settings } from "../types";
import { scanCard } from "../api";
import { makeThumbnail, money, sleep } from "../utils";
import { makeT } from "../i18n";
import CameraModal from "./CameraModal";

interface Props {
  settings: Settings;
  onSave: (result: ScanResult, frontDataUrl: string | undefined) => void;
}

interface Row {
  id: number;
  dataUrl: string;
  status: "pending" | "scanning" | "done" | "error";
  result?: ScanResult;
  error?: string;
  saved?: boolean;
}

let rid = 1;

export default function BulkView({ settings, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = makeT(settings.language);

  function addImage(dataUrl: string) {
    setRows((prev) => [...prev, { id: rid++, dataUrl, status: "pending" }]);
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
    // Bulk scans skip live grounding (one fast call each) so a stack of cards
    // doesn't trip the free-tier rate limit. Sequential with a small gap.
    const fastSettings = { ...settings, liveData: false };
    const pending = rows.filter((r) => r.status === "pending" || r.status === "error");
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      patch(row.id, { status: "scanning", error: undefined });
      try {
        const result = await scanCard([row.dataUrl], fastSettings);
        patch(row.id, { status: "done", result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Scan failed.";
        patch(row.id, { status: "error", error: msg });
        if (msg.toLowerCase().includes("rate limit")) break; // stop; user can resume
      }
      if (i < pending.length - 1) await sleep(1500);
    }
    setRunning(false);
  }

  async function saveOne(row: Row) {
    if (!row.result) return;
    const thumb = await makeThumbnail(row.dataUrl);
    onSave(row.result, thumb);
    patch(row.id, { saved: true });
  }

  async function saveAll() {
    for (const row of rows) {
      if (row.result?.identified && !row.saved) await saveOne(row);
    }
  }

  const done = rows.filter((r) => r.status === "done" && r.result?.identified);
  const total = done.reduce((s, r) => s + (r.result!.estimatedValue.mid || 0), 0);
  const currency = done[0]?.result?.estimatedValue.currency || settings.currency;

  return (
    <div>
      <div className="card">
        <h2>{t("bulk.title")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Scan a whole stack at once — add a photo of <strong>each</strong> card (one per card), then
          scan them all. Fast mode (no live web lookup) keeps it reliable on the free tier. For the
          most accurate current value on a single card, use the Scan tab instead.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn secondary" onClick={() => setShowCamera(true)} disabled={running}>📸 Add photo</button>
          <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={running}>Upload photos</button>
          {rows.length > 0 && (
            <button className="btn" onClick={scanAll} disabled={running}>
              {running ? <><span className="spinner" />Scanning…</> : `Scan all (${rows.filter(r => r.status !== "done").length})`}
            </button>
          )}
          {rows.length > 0 && (
            <button className="btn ghost" onClick={() => setRows([])} disabled={running}>Clear</button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {done.length > 0 && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <span className="muted" style={{ fontSize: 12 }}>{done.length} identified · estimated total</span>
            <div className="value-big" style={{ fontSize: 22 }}>{money(total, currency)}</div>
          </div>
          <button className="btn" onClick={saveAll} disabled={running}>★ Save all to binder</button>
        </div>
      )}

      {rows.map((row) => (
        <div className="card" key={row.id}>
          <div className="binder-row">
            <img className="thumb" src={row.dataUrl} alt="card" />
            <div style={{ flex: 1, minWidth: 0 }}>
              {row.status === "scanning" && <div className="muted"><span className="spinner" />Scanning…</div>}
              {row.status === "pending" && <div className="muted">Ready to scan</div>}
              {row.status === "error" && <div className="warn">{row.error}</div>}
              {row.status === "done" && row.result && (
                <>
                  <div style={{ fontWeight: 700 }}>{row.result.player || "Unidentified"}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[row.result.year, row.result.manufacturer, row.result.setName].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {row.result.sport && <span className="pill">{row.result.sport}</span>}
                    {row.result.parallel && <span className="pill gold">{row.result.parallel}</span>}
                  </div>
                </>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              {row.status === "done" && row.result?.identified && (
                <>
                  <div className="value-big" style={{ fontSize: 18 }}>
                    {money(row.result.estimatedValue.mid, row.result.estimatedValue.currency)}
                  </div>
                  <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => saveOne(row)} disabled={row.saved}>
                    {row.saved ? "✓ Saved" : "★ Save"}
                  </button>
                </>
              )}
              <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setRows((p) => p.filter((r) => r.id !== row.id))} disabled={running}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}

      {showCamera && <CameraModal onCapture={addImage} onClose={() => setShowCamera(false)} />}
    </div>
  );
}
