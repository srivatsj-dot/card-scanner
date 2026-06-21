// Real, dated game results from free public APIs, used to ground the morning
// digest in VERIFIED facts instead of the model's unreliable memory of
// "yesterday". Two sources:
//   • Official league APIs (MLB Stats API, NHL web API) — richest detail
//     (box-score performances), used for those two leagues.
//   • ESPN's public scoreboard API — one uniform endpoint covering dozens of
//     leagues and tournaments (NBA, NFL, every major soccer league, the World
//     Cup, Champions League, college, etc.). Adding a competition is a one-line
//     entry in ESPN_BY_CAT below; off-season leagues simply return nothing.
// All free, no keys. Best-effort: any failure returns null and that league is
// just omitted, so the digest still works.

const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const NHL_BASE = "https://api-web.nhle.com/v1";
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string, ms = 8000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
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

// --- MLB: scores + standout batting/pitching lines (official box scores) ----
export async function mlbFacts(date: string): Promise<SportFacts | null> {
  const sched = await getJson(`${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=team,linescore`);
  const games = sched?.dates?.[0]?.games;
  if (!Array.isArray(games) || games.length === 0) return null;

  const finals = games
    .filter((g: any) => /final/i.test(g?.status?.abstractGameState || g?.status?.detailedState || ""))
    .slice(0, 18);
  if (finals.length === 0) return null;

  const boxes = await Promise.all(
    finals.map((g: any) => getJson(`${MLB_BASE}/game/${g.gamePk}/boxscore`))
  );

  const scores: string[] = [];
  const perf: string[] = [];
  finals.forEach((g: any, i: number) => {
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

// --- NHL: results + multi-goal scorers (official) ---------------------------
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

// --- ESPN: one generic client for any league/tournament ESPN carries --------
interface EspnLeague { sport: string; league: string; label: string; leaders?: boolean }

// Map each app category to the ESPN leagues/tournaments worth checking. Seasonal
// events (World Cup, Euro, WBC, Club World Cup) light up only when in season and
// are otherwise skipped automatically. Add a competition by adding a line here.
const ESPN_BY_CAT: Record<string, EspnLeague[]> = {
  baseball: [
    { sport: "baseball", league: "college-baseball", label: "Baseball (NCAA)" },
    { sport: "baseball", league: "world-baseball-classic", label: "Baseball (WBC)" },
  ],
  basketball: [
    { sport: "basketball", league: "nba", label: "Basketball (NBA)", leaders: true },
    { sport: "basketball", league: "wnba", label: "Basketball (WNBA)", leaders: true },
    { sport: "basketball", league: "mens-college-basketball", label: "Basketball (NCAA M)", leaders: true },
  ],
  football: [
    { sport: "football", league: "nfl", label: "Football (NFL)", leaders: true },
    { sport: "football", league: "college-football", label: "Football (NCAA)", leaders: true },
  ],
  soccer: [
    { sport: "soccer", league: "eng.1", label: "Soccer (Premier League)" },
    { sport: "soccer", league: "esp.1", label: "Soccer (La Liga)" },
    { sport: "soccer", league: "ita.1", label: "Soccer (Serie A)" },
    { sport: "soccer", league: "ger.1", label: "Soccer (Bundesliga)" },
    { sport: "soccer", league: "fra.1", label: "Soccer (Ligue 1)" },
    { sport: "soccer", league: "usa.1", label: "Soccer (MLS)" },
    { sport: "soccer", league: "mex.1", label: "Soccer (Liga MX)" },
    { sport: "soccer", league: "uefa.champions", label: "Soccer (Champions League)" },
    { sport: "soccer", league: "uefa.europa", label: "Soccer (Europa League)" },
    { sport: "soccer", league: "fifa.world", label: "Soccer (World Cup)" },
    { sport: "soccer", league: "fifa.cwc", label: "Soccer (Club World Cup)" },
    { sport: "soccer", league: "uefa.euro", label: "Soccer (Euro)" },
    { sport: "soccer", league: "conmebol.america", label: "Soccer (Copa América)" },
  ],
};

function espnLeaderLine(competitor: any): string | null {
  const top = competitor?.leaders?.[0]?.leaders?.[0];
  const name = top?.athlete?.displayName;
  const val = top?.displayValue;
  return name && val ? `${name} ${val}` : null;
}

export async function espnFacts(cfg: EspnLeague, date: string): Promise<SportFacts | null> {
  const d = date.replace(/-/g, "");
  const data = await getJson(`${ESPN_BASE}/${cfg.sport}/${cfg.league}/scoreboard?dates=${d}`);
  const events = data?.events;
  if (!Array.isArray(events) || events.length === 0) return null;

  const lines: string[] = [];
  for (const ev of events) {
    if (!ev?.status?.type?.completed) continue;
    const comp = ev?.competitions?.[0];
    const cs = comp?.competitors || [];
    const home = cs.find((c: any) => c.homeAway === "home");
    const away = cs.find((c: any) => c.homeAway === "away");
    if (!home || !away) continue;
    const hn = home.team?.abbreviation || home.team?.shortDisplayName || home.team?.displayName;
    const an = away.team?.abbreviation || away.team?.shortDisplayName || away.team?.displayName;
    if (!hn || !an || home.score == null || away.score == null) continue;
    let line = `${an} ${away.score}, ${hn} ${home.score} (final)`;
    if (cfg.leaders) {
      const ls = [espnLeaderLine(away), espnLeaderLine(home)].filter(Boolean);
      if (ls.length) line += ` — ${ls.join(", ")}`;
    }
    lines.push("  • " + line);
  }
  return lines.length ? { sport: cfg.label, lines: ["Final scores:", ...lines] } : null;
}

// Assemble a verified-facts block for the requested categories on a date.
// Returns "" when nothing is available so the caller can omit it cleanly.
export async function verifiedSportsFacts(cats: string[], date: string): Promise<string> {
  const has = (...keys: string[]) => cats.some((c) => keys.some((k) => c.toLowerCase().includes(k)));
  const jobs: Promise<SportFacts | null>[] = [];

  if (has("base")) {
    jobs.push(mlbFacts(date));
    ESPN_BY_CAT.baseball.forEach((l) => jobs.push(espnFacts(l, date)));
  }
  if (has("basket")) ESPN_BY_CAT.basketball.forEach((l) => jobs.push(espnFacts(l, date)));
  if (has("football")) ESPN_BY_CAT.football.forEach((l) => jobs.push(espnFacts(l, date)));
  if (has("soccer")) ESPN_BY_CAT.soccer.forEach((l) => jobs.push(espnFacts(l, date)));
  if (has("hockey", "nhl")) jobs.push(nhlFacts(date));
  // Cricket and Pokémon have no reliable free feed here — they fall back to the
  // model's search-grounded prose (still date-filtered downstream).

  if (jobs.length === 0) return "";
  const facts = (await Promise.all(jobs.map((j) => j.catch(() => null)))).filter(
    (f): f is SportFacts => !!f
  );
  if (facts.length === 0) return "";
  return facts
    .map((f) => `${f.sport} — VERIFIED results for ${date}:\n${f.lines.join("\n")}`)
    .join("\n\n");
}
