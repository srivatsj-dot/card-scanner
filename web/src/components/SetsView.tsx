import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedCard, Settings, ChecklistResult } from "../types";
import { getChecklist } from "../api";
import { useT } from "../translator";

interface Props {
  saved: SavedCard[];
  settings: Settings;
  onWish: (texts: string[]) => void;
  onSetPct: (pct: number) => void;
}

// Per-set tallies of the DIFFERENT kinds of cards in a set — not just base cards,
// but parallels, autos, relics, inserts, numbered and graded copies too.
interface TypeCounts { base: number; parallel: number; auto: number; relic: number; insert: number; numbered: number; graded: number; }
type TypeKey = keyof TypeCounts;

const TYPE_META: { key: TypeKey; emoji: string; label: string }[] = [
  { key: "base", emoji: "🃏", label: "base" },
  { key: "parallel", emoji: "🌈", label: "parallels" },
  { key: "auto", emoji: "✍️", label: "autos" },
  { key: "relic", emoji: "🧵", label: "relics" },
  { key: "insert", emoji: "✨", label: "inserts" },
  { key: "numbered", emoji: "#️⃣", label: "numbered" },
  { key: "graded", emoji: "🛡️", label: "graded" },
];

interface SetGroup {
  key: string;
  year: string; manufacturer: string; setName: string; sport: string;
  label: string;
  numbers: string[]; // distinct base card numbers owned
  count: number;     // cards owned in this set
  thumb: string;
  types: TypeCounts;
}

// Which type buckets a single card counts toward (a card can be several at once,
// e.g. a numbered auto). "base" only when it's none of the special kinds.
function classify(r: SavedCard["result"]): TypeKey[] {
  const blob = `${r.specialEdition || ""} ${r.parallel || ""} ${r.setName || ""}`.toLowerCase();
  const auto = /auto|signed|signature/.test(blob);
  const relic = /relic|patch|jersey|memorabilia|swatch/.test(blob);
  const parallel = !!(r.parallel && r.parallel.trim()) ||
    /refractor|prizm|parallel|holo|foil|cracked ice|wave|shimmer|mojo|\bgold\b|\bsilver\b|\bpink\b|\bgreen\b|velocity|disco/.test(blob);
  const insert = /insert|subset/.test(blob);
  const keys: TypeKey[] = [];
  if (auto) keys.push("auto");
  if (relic) keys.push("relic");
  if (parallel) keys.push("parallel");
  if (insert) keys.push("insert");
  if (r.serialNumber) keys.push("numbered");
  if (/\bpsa\b|\bbgs\b|\bsgc\b|\bcgc\b|graded|slab/.test(blob)) keys.push("graded");
  if (!auto && !relic && !parallel && !insert) keys.push("base");
  return keys;
}

// Group the binder into sets so completion can be tracked per set. Works for any
// category (baseball, Pokémon, etc.) — grouping is by year + brand + set name.
// Set names come back with small differences between scans — "Topps Series 1" vs
// "Topps series one", stray punctuation, the brand repeated inside the set name.
// Matching the raw strings split ONE set into many groups of a single card each,
// which is why a 25-card set showed as "1 card owned". Normalise hard before
// keying: lowercase, spell out numerals, drop punctuation and filler words, and
// remove the manufacturer if it's echoed inside the set name.
const NUMERALS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => NUMERALS[w] ?? w)
    .filter((w) => !["the", "baseball", "basketball", "football", "hockey", "soccer", "cards", "card", "trading", "tcg", "edition"].includes(w))
    .join(" ")
    .trim();
}
function setKeyOf(r: { year?: string | null; manufacturer?: string | null; setName?: string | null }) {
  const year = (r.year || "").trim();
  const man = norm(r.manufacturer || "");
  let set = norm(r.setName || "");
  if (man && set.startsWith(`${man} `)) set = set.slice(man.length + 1); // "topps chrome" under Topps → "chrome"
  return { year, man, set, key: `${year}|${man}|${set}` };
}

function groupSets(saved: SavedCard[]): SetGroup[] {
  const map = new Map<string, SetGroup>();
  for (const c of saved) {
    const r = c.result;
    const year = (r.year || "").trim();
    const manufacturer = (r.manufacturer || "").trim();
    const setName = (r.setName || "").trim();
    if (!setName && !manufacturer) continue; // not enough to identify a set
    const { key } = setKeyOf(r);
    let g = map.get(key);
    if (!g) {
      g = {
        key, year, manufacturer, setName, sport: (r.sport || "").trim(),
        label: [year, manufacturer, setName].filter(Boolean).join(" "),
        numbers: [], count: 0, thumb: c.thumbnail || "",
        types: { base: 0, parallel: 0, auto: 0, relic: 0, insert: 0, numbered: 0, graded: 0 },
      };
      map.set(key, g);
    }
    g.count++;
    if (!g.thumb && c.thumbnail) g.thumb = c.thumbnail;
    for (const k of classify(r)) g.types[k]++;
    const num = (r.cardNumber || "").trim();
    if (num && !g.numbers.includes(num)) g.numbers.push(num);
  }
  // Second pass: fold year-less groups into the same set that DOES have a year
  // (a scan that couldn't read the year shouldn't become its own "set").
  const all = [...map.values()];
  const byNameless = new Map<string, SetGroup>();
  for (const g of all) {
    if (!g.year) continue;
    const k = `${norm(g.manufacturer)}|${norm(g.setName)}`;
    const best = byNameless.get(k);
    if (!best || g.count > best.count) byNameless.set(k, g);
  }
  const merged: SetGroup[] = [];
  for (const g of all) {
    const host = !g.year ? byNameless.get(`${norm(g.manufacturer)}|${norm(g.setName)}`) : undefined;
    if (host && host !== g) {
      host.count += g.count;
      for (const k of Object.keys(g.types) as (keyof SetGroup["types"])[]) host.types[k] += g.types[k];
      for (const n of g.numbers) if (!host.numbers.includes(n)) host.numbers.push(n);
      if (!host.thumb && g.thumb) host.thumb = g.thumb;
      continue; // absorbed
    }
    merged.push(g);
  }
  return merged.sort((a, b) => b.count - a.count);
}

// The highest completion badge a set has earned, if any.
function badgeFor(pct: number | null): { emoji: string; label: string } | null {
  if (pct == null) return null;
  if (pct >= 100) return { emoji: "🏆", label: "Complete!" };
  if (pct >= 75) return { emoji: "🔥", label: "Home stretch" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway" };
  if (pct >= 25) return { emoji: "🥉", label: "Set started" };
  return null;
}

// Cache checked set sizes so we don't re-hit the AI on every visit. Set sizes
// don't change, so a week-long TTL keeps auto-check instant after the first look.
const CACHE_KEY = "card-scanner-setcache";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
type Cache = Record<string, { at: number; res: ChecklistResult }>;
const loadCache = (): Cache => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
};
const saveCacheEntry = (key: string, res: ChecklistResult) => {
  const c = loadCache();
  c[key] = { at: Date.now(), res };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota — ignore */ }
};

export default function SetsView({ saved, settings, onWish, onSetPct }: Props) {
  const t = useT();
  const groups = useMemo(() => groupSets(saved), [saved]);
  const [results, setResults] = useState<Record<string, ChecklistResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [wished, setWished] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inflight = useRef<Set<string>>(new Set());

  async function check(g: SetGroup) {
    if (inflight.current.has(g.key)) return;
    inflight.current.add(g.key);
    setLoading((l) => ({ ...l, [g.key]: true }));
    setErrors((e) => ({ ...e, [g.key]: "" }));
    try {
      const res = await getChecklist(
        { year: g.year, manufacturer: g.manufacturer, setName: g.setName, sport: g.sport },
        g.numbers,
        settings
      );
      setResults((r) => ({ ...r, [g.key]: res }));
      saveCacheEntry(g.key, res);
      if (res.baseSetSize > 0) {
        onSetPct(Math.min(1, g.numbers.length / res.baseSetSize));
      }
    } catch (e) {
      setErrors((er) => ({ ...er, [g.key]: e instanceof Error ? e.message : "Couldn't load the checklist." }));
    } finally {
      inflight.current.delete(g.key);
      setLoading((l) => ({ ...l, [g.key]: false }));
    }
  }

  // Auto-check on open: seed from cache instantly, then look up the rest with a
  // small concurrency cap so progress bars fill in without a manual tap.
  const groupKeys = groups.map((g) => g.key).join(",");
  useEffect(() => {
    const cache = loadCache();
    const seeded: Record<string, ChecklistResult> = {};
    for (const g of groups) {
      const c = cache[g.key];
      if (c && Date.now() - c.at < CACHE_TTL) seeded[g.key] = c.res;
    }
    if (Object.keys(seeded).length) {
      setResults((r) => ({ ...seeded, ...r }));
      let best = 0;
      for (const g of groups) {
        const res = seeded[g.key];
        if (res && res.baseSetSize > 0) best = Math.max(best, Math.min(1, g.numbers.length / res.baseSetSize));
      }
      if (best > 0) onSetPct(best);
    }

    let cancelled = false;
    const queue = groups.filter((g) => !seeded[g.key]);
    let idx = 0, active = 0;
    const pump = () => {
      while (active < 2 && idx < queue.length) {
        const g = queue[idx++];
        active++;
        check(g).finally(() => { active--; if (!cancelled) pump(); });
      }
    };
    pump();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKeys]);

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
          {t("Your binder grouped into sets — base cards, parallels, autos, relics and more. Completion is checked automatically; hit a milestone to earn a badge.")}
        </p>
      </div>

      {groups.map((g) => {
        const res = results[g.key];
        const isLoading = !!loading[g.key];
        const pct = res && res.baseSetSize > 0
          ? Math.min(100, Math.round((g.numbers.length / res.baseSetSize) * 100))
          : null;
        const badge = badgeFor(pct);
        const chips = TYPE_META.filter((m) => g.types[m.key] > 0);
        const isOpen = expanded[g.key];
        return (
          <div className="card set-card" key={g.key}>
            <div className="set-head">
              {g.thumb ? <img className="thumb" src={g.thumb} alt="" /> : <div className="thumb placeholder">🗂️</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>{g.label || t("Unknown set")}</span>
                  {badge && <span className="set-badge">{badge.emoji} {t(badge.label)}</span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {g.count} {t("cards owned")}
                  {g.sport ? ` · ${g.sport}` : ""}
                  {res && res.baseSetSize > 0 ? ` · ${g.numbers.length}/${res.baseSetSize} ${t("base")}` : ""}
                </div>
              </div>
            </div>

            {/* Always-on progress bar */}
            <div className="set-progress" style={{ marginTop: 12 }} title={pct != null ? `${pct}%` : undefined}>
              <div
                className="set-progress-fill"
                style={{ width: pct != null ? `${pct}%` : "12%", opacity: pct != null ? 1 : 0.5 }}
              />
              <span className="set-progress-label">
                {pct != null
                  ? `${pct}% ${t("complete")}`
                  : isLoading
                    ? t("Checking set size…")
                    : `${g.count} ${t("owned")}`}
              </span>
            </div>

            {chips.length > 0 && (
              <div className="chips" style={{ marginTop: 10 }}>
                {chips.map((m) => (
                  <span className="chip" key={m.key}>{m.emoji} {g.types[m.key]} {t(m.label)}</span>
                ))}
              </div>
            )}

            {errors[g.key] && <div className="error-box" style={{ marginTop: 10 }}>{errors[g.key]}</div>}

            {res && (
              <div style={{ marginTop: 10 }}>
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  {res.summary}
                  {res.baseSetSize > 0 && res.sizeConfidence === "low" && ` (${t("set size uncertain")})`}
                  {res.baseSetSize === 0 && ` (${t("couldn't pin down the set size")})`}
                </p>

                {res.notableMissing.length > 0 && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn ghost small" onClick={() => setExpanded((x) => ({ ...x, [g.key]: !x[g.key] }))}>
                        {isOpen ? "▾" : "▸"} {res.notableMissing.length} {t("key cards missing")}
                      </button>
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
                    {isOpen && res.notableMissing.map((m, i) => (
                      <div className="trade-rec" key={i}>
                        <div className="name">#{m.cardNumber} · {m.player}</div>
                        <div className="sub">{m.note}{m.estimatedValue ? ` · ${m.estimatedValue}` : ""}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <button
              className="btn ghost small"
              style={{ marginTop: 10 }}
              onClick={() => check(g)}
              disabled={isLoading}
            >
              {isLoading ? <><span className="spinner" />{t("Checking…")}</> : res ? `↻ ${t("Refresh")}` : t("Check completion")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
