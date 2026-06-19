import type { SavedCard, WishItem } from "../types";
import { ACHIEVEMENTS, computeStats } from "../achievements";
import { makeT } from "../i18n";

interface Props {
  saved: SavedCard[];
  wishlist: WishItem[];
  scans: number;
  lang: string;
}

export default function AwardsView({ saved, wishlist, scans, lang }: Props) {
  const t = makeT(lang);
  const stats = computeStats(saved, wishlist, scans);
  const earnedCount = ACHIEVEMENTS.filter((a) => a.earned(stats)).length;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>🏆 {t("awards.title")}</h2>
          <div className="value-big" style={{ fontSize: 22 }}>{earnedCount}/{ACHIEVEMENTS.length}</div>
        </div>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
          Earn badges as your collection grows.
        </p>
      </div>

      <div className="card">
        <div className="award-grid">
          {ACHIEVEMENTS.map((a) => {
            const got = a.earned(stats);
            return (
              <div key={a.id} className={`award ${got ? "earned" : "locked"}`}>
                <div className="award-emoji">{got ? a.emoji : "🔒"}</div>
                <div className="award-title">{a.title}</div>
                <div className="award-desc">{a.desc}</div>
                {!got && a.progress && <div className="award-progress">{a.progress(stats)}</div>}
                {got && <div className="award-badge">Unlocked</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
