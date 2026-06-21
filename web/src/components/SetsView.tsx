import { useMemo, useState } from "react";
import type { SavedCard, Settings, ChecklistResult } from "../types";
import { getChecklist } from "../api";
import { useT } from "../translator";

interface Props {
  saved: SavedCard[];
  settings: Settings;
  onWish: (texts: string[]) => void;
}

interface SetGroup {
  key: string;
  year: string;
  manufacturer: string;
  setName: string;
  sport: string;
  label: string;
  numbers: string[]; // distinct card numbers owned
  count: number; // cards owned in this set
  thumb: string;
}

// Group the binder into sets so completion can be tracked per set.
function groupSets(saved: SavedCard[]): SetGroup[] {
  const map = new Map<string, SetGroup>();
  for (const c of saved) {
    const r = c.result;
    const year = (r.year || "").trim();
    const manufacturer = (r.manufacturer || "").trim();
    const setName = (r.setName || "").trim();
    if (!setName && !manufacturer) continue; // not enough to identify a set
    const key = `${year}|${manufacturer}|${setName}`.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = {
        key, year, manufacturer, setName, sport: (r.sport || "").trim(),
        label: [year, manufacturer, setName].filter(Boolean).join(" "),
        numbers: [], count: 0, thumb: c.thumbnail || "",
      };
      map.set(key, g);
    }
    g.count++;
    if (!g.thumb && c.thumbnail) g.thumb = c.thumbnail;
    const num = (r.cardNumber || "").trim();
    if (num && !g.numbers.includes(num)) g.numbers.push(num);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export default function SetsView({ saved, settings, onWish }: Props) {
  const t = useT();
  const groups = useMemo(() => groupSets(saved), [saved]);
  const [results, setResults] = useState<Record<string, ChecklistResult>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [wished, setWished] = useState<Record<string, boolean>>({});

  async function check(g: SetGroup) {
    setLoading(g.key);
    setErrors((e) => ({ ...e, [g.key]: "" }));
    try {
      const res = await getChecklist(
        { year: g.year, manufacturer: g.manufacturer, setName: g.setName, sport: g.sport },
        g.numbers,
        settings
      );
      setResults((r) => ({ ...r, [g.key]: res }));
    } catch (e) {
      setErrors((er) => ({ ...er, [g.key]: e instanceof Error ? e.message : "Couldn't load the checklist." }));
    } finally {
      setLoading(null);
    }
  }

  if (groups.length === 0) {
    return (
      <div className="card">
        <h2>{t("Set completion")}</h2>
        <p className="muted">{t("Scan some cards into your binder and they'll group into sets here, so you can track how close each one is to complete.")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>{t("Set completion")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Your binder grouped into sets. Check a set to see how big it is, how close you are, and which key cards you're still missing.")}
        </p>
      </div>

      {groups.map((g) => {
        const res = results[g.key];
        const pct = res && res.baseSetSize > 0
          ? Math.min(100, Math.round((g.numbers.length / res.baseSetSize) * 100))
          : null;
        return (
          <div className="card" key={g.key}>
            <div className="set-head">
              {g.thumb ? <img className="thumb" src={g.thumb} alt="" /> : <div className="thumb placeholder">🗂️</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{g.label || t("Unknown set")}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {g.count} {t("cards owned")}
                  {g.sport ? ` · ${g.sport}` : ""}
                  {res && res.baseSetSize > 0 ? ` · ${g.numbers.length}/${res.baseSetSize} ${t("base")}` : ""}
                </div>
              </div>
              {!res && (
                <button className="btn secondary small" onClick={() => check(g)} disabled={loading === g.key}>
                  {loading === g.key ? <><span className="spinner" />{t("Checking…")}</> : t("Check completion")}
                </button>
              )}
            </div>

            {errors[g.key] && <div className="error-box" style={{ marginTop: 10 }}>{errors[g.key]}</div>}

            {res && (
              <div style={{ marginTop: 12 }}>
                {pct !== null && (
                  <div className="set-progress" title={`${pct}%`}>
                    <div className="set-progress-fill" style={{ width: `${pct}%` }} />
                    <span className="set-progress-label">{pct}% {t("complete")}</span>
                  </div>
                )}
                <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                  {res.summary}
                  {res.baseSetSize > 0 && res.sizeConfidence === "low" && ` (${t("set size uncertain")})`}
                  {res.baseSetSize === 0 && ` (${t("couldn't pin down the set size")})`}
                </p>

                {res.notableMissing.length > 0 && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <h4 style={{ margin: 0 }}>{t("Key cards you're missing")}</h4>
                      <button
                        className="btn ghost small"
                        disabled={wished[g.key]}
                        onClick={() => {
                          onWish(res.notableMissing.map((m) => `${g.label} ${m.player} #${m.cardNumber}`));
                          setWished((w) => ({ ...w, [g.key]: true }));
                        }}
                      >
                        {wished[g.key] ? t("✓ Added") : `♡ ${t("Add all to wishlist")}`}
                      </button>
                    </div>
                    {res.notableMissing.map((m, i) => (
                      <div className="trade-rec" key={i}>
                        <div className="name">#{m.cardNumber} · {m.player}</div>
                        <div className="sub">{m.note}{m.estimatedValue ? ` · ${m.estimatedValue}` : ""}</div>
                      </div>
                    ))}
                  </>
                )}
                <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => check(g)} disabled={loading === g.key}>
                  ↻ {t("Refresh")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
