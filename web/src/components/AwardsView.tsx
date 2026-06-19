import type { SavedCard, WishItem } from "../types";
import { ACHIEVEMENTS, computeStats } from "../achievements";
import { useT } from "../translator";

interface Props {
  saved: SavedCard[];
  wishlist: WishItem[];
  scans: number;
  trades: number;
  lang: string;
}

export default function AwardsView({ saved, wishlist, scans, trades, lang }: Props) {
  const t = useT();
  const stats = computeStats(saved, wishlist, scans, trades, lang);
  const earnedCount = ACHIEVEMENTS.filter((a) => a.earned(stats)).length;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>🏆 {t("Achievements")}</h2>
          <div className="value-big" style={{ fontSize: 22 }}>{earnedCount}/{ACHIEVEMENTS.length}</div>
        </div>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
          {t("Earn badges as your collection grows. Most stay hidden until you unlock them.")}
        </p>
      </div>

      <div className="card">
        <div className="award-grid">
          {ACHIEVEMENTS.map((a) => {
            const got = a.earned(stats);
            return (
              <div key={a.id} className={`award ${got ? "earned" : "locked"}`}>
                <div className="award-emoji">{got ? a.emoji : "🔒"}</div>
                <div className="award-title">{got ? t(a.title) : t("Locked")}</div>
                <div className="award-desc">{got ? t(a.desc) : t("Keep collecting to reveal this one.")}</div>
                {got && <div className="award-badge">{t("Unlocked")}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
