// Real, dated game results from free public APIs (MLB Stats API + NHL web API).
// The morning digest uses these as VERIFIED facts so baseball/hockey scores and
// performances are accurate and correctly dated — instead of the model trying
// to recall "yesterday" from training knowledge it doesn't have. Best-effort:
// any failure returns null and the digest falls back to search-grounded prose.

const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const NHL_BASE = "https://api-web.nhle.com/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string, ms = 8000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface SportFacts {
  sport: string;
  lines: string[];
}

// --- MLB: scores + standout batting/pitching lines for a given date ---------
export async function mlbFacts(date: string): Promise<SportFacts | null> {
  const sched = await getJson(`${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=team,linescore`);
  const games = sched?.dates?.[0]?.games;
  if (!Array.isArray(games) || games.length === 0) return null;

  const finals = games.filter((g: any) =>
    /final/i.test(g?.status?.abstractGameState || g?.status?.detailedState || "")
  );
  if (finals.length === 0) return null;

  const boxes = await Promise.all(
    finals.slice(0, 18).map((g: any) => getJson(`${MLB_BASE}/game/${g.gamePk}/boxscore`))
  );

  const scores: string[] = [];
  const perf: string[] = [];
  finals.slice(0, 18).forEach((g: any, i: number) => {
    const away = g.teams?.away, home = g.teams?.home;
    const awayName = away?.team?.name, homeName = home?.team?.name;
    const awayAbbr = away?.team?.abbreviation || awayName, homeAbbr = home?.team?.abbreviation || homeName;
    const as = away?.score, hs = home?.score;
    if (awayName && homeName && Number.isFinite(as) && Number.isFinite(hs)) {
      scores.push(`${awayName} ${as}, ${homeName} ${hs} (final)`);
    }
    const box = boxes[i];
    if (!box) return;
    (["away", "home"] as const).forEach((sideKey) => {
      const abbr = sideKey === "away" ? awayAbbr : homeAbbr;
      const players = box.teams?.[sideKey]?.players || {};
      for (const id of Object.keys(players)) {
        const p = players[id];
        const name = p?.person?.fullName;
        if (!name) continue;
        const b = p?.stats?.batting || {};
        const hr = Number(b.homeRuns) || 0, rbi = Number(b.rbi) || 0, hits = Number(b.hits) || 0;
        if (hr >= 2 || rbi >= 5 || hits >= 4) {
          const bits: string[] = [];
          if (hr) bits.push(`${hr} HR`);
          if (rbi) bits.push(`${rbi} RBI`);
          if (hits) bits.push(`${hits} hits`);
          perf.push(`${name} (${abbr}): ${bits.join(", ")}`);
        }
        const pi = p?.stats?.pitching || {};
        const k = Number(pi.strikeOuts) || 0;
        const ip = parseFloat(pi.inningsPitched) || 0;
        const er = Number(pi.earnedRuns);
        if (k >= 10 || (ip >= 7 && er === 0)) {
          const bits: string[] = [`${pi.inningsPitched} IP`];
          if (k) bits.push(`${k} K`);
          if (Number.isFinite(er)) bits.push(`${er} ER`);
          perf.push(`${name} (${abbr}, pitching): ${bits.join(", ")}`);
        }
      }
    });
  });

  const lines = [
    ...(perf.length ? ["Standout performances:", ...perf.map((p) => "  • " + p)] : []),
    ...(scores.length ? ["Final scores:", ...scores.map((s) => "  • " + s)] : []),
  ];
  return lines.length ? { sport: "Baseball (MLB)", lines } : null;
}

// --- NHL: results + multi-goal scorers for a given date ---------------------
export async function nhlFacts(date: string): Promise<SportFacts | null> {
  const data = await getJson(`${NHL_BASE}/score/${date}`);
  const games = data?.games;
  if (!Array.isArray(games) || games.length === 0) return null;

  const lines: string[] = [];
  for (const g of games) {
    if (!/FINAL|OFF/i.test(g?.gameState || "")) continue;
    const a = g?.awayTeam, h = g?.homeTeam;
    const an = a?.abbrev, hn = h?.abbrev, as = a?.score, hs = h?.score;
    if (!an || !hn || !Number.isFinite(as) || !Number.isFinite(hs)) continue;
    let line = `${an} ${as}, ${hn} ${hs} (final)`;
    const goals = g?.goals;
    if (Array.isArray(goals) && goals.length) {
      const counts: Record<string, number> = {};
      for (const gl of goals) {
        const nm = gl?.name?.default || `${gl?.firstName?.default || ""} ${gl?.lastName?.default || ""}`.trim();
        if (nm) counts[nm] = (counts[nm] || 0) + 1;
      }
      const multi = Object.entries(counts).filter(([, c]) => c >= 2).map(([n, c]) => `${n} ${c} goals`);
      if (multi.length) line += ` — ${multi.join(", ")}`;
    }
    lines.push("  • " + line);
  }
  return lines.length ? { sport: "Hockey (NHL)", lines: ["Final scores:", ...lines] } : null;
}

// Assemble a verified-facts block for the requested categories on a date.
// Returns "" when nothing is available so the caller can omit it cleanly.
export async function verifiedSportsFacts(cats: string[], date: string): Promise<string> {
  const wants = (...keys: string[]) => cats.some((c) => keys.some((k) => c.toLowerCase().includes(k)));
  const jobs: Promise<SportFacts | null>[] = [];
  if (wants("base")) jobs.push(mlbFacts(date));
  if (wants("hockey", "nhl")) jobs.push(nhlFacts(date));
  if (jobs.length === 0) return "";
  const facts = (await Promise.all(jobs.map((j) => j.catch(() => null)))).filter(
    (f): f is SportFacts => !!f
  );
  if (facts.length === 0) return "";
  return facts
    .map((f) => `${f.sport} — VERIFIED results for ${date}:\n${f.lines.join("\n")}`)
    .join("\n\n");
}
