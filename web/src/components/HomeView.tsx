import type { SavedCard, WishItem } from "../types";
import { money } from "../utils";
import { useT } from "../translator";
import Logo from "./Logo";

interface Props {
  saved: SavedCard[];
  wishlist: WishItem[];
  scans: number;
  currency: string;
  onGo: (v: "scan" | "search" | "bulk" | "today" | "trade" | "binder" | "wishlist") => void;
}

export default function HomeView({ saved, wishlist, scans, currency, onGo }: Props) {
  const t = useT();
  const total = saved.reduce((s, c) => s + (c.result.estimatedValue?.mid || 0), 0);
  const cur = saved[0]?.result.estimatedValue?.currency || currency;

  const features: { icon: string; title: string; body: string }[] = [
    { icon: "📷", title: t("Scan & appraise"), body: t("Point your camera at any card — it identifies the player, set, parallel, and serial, then gives a value range and a rating out of 100.") },
    { icon: "🔍", title: t("Look beneath the surface"), body: t("Print runs, why a parallel matters, hidden stats, and a read on the player's trajectory — heating up or cooling off.") },
    { icon: "🤝", title: t("Trade smarter"), body: t("Check if a trade is fair, get ideas for what to ask for, and plan a path from cards you own to a grail.") },
    { icon: "📒", title: t("Track your collection"), body: t("Keep a binder and wishlist that re-price themselves, track set completion, and earn achievements as you grow.") },
    { icon: "☀️", title: t("Morning briefing"), body: t("Real, dated results for your players and cards every morning — across baseball, basketball, football, soccer, cricket, hockey, and Pokémon.") },
    { icon: "💬", title: t("Ask anything"), body: t("A built-in chat that already knows the card you just scanned.") },
  ];

  return (
    <div className="home">
      <div className="card home-hero">
        <div className="home-hero-logo"><Logo size={56} /></div>
        <h1 className="home-title">Card-O-Rama</h1>
        <p className="home-tagline">{t("Scan it. Price it. Trade smarter.")}</p>
        <div className="home-cta">
          <button className="btn" onClick={() => onGo("scan")}>📷 {t("Scan a card")}</button>
          <button className="btn secondary" onClick={() => onGo("search")}>🔍 {t("Search by description")}</button>
        </div>
      </div>

      {saved.length > 0 && (
        <div className="card home-stats">
          <button className="home-stat" onClick={() => onGo("binder")}>
            <span className="home-stat-num">{saved.length}</span>
            <span className="home-stat-label">{t("cards")}</span>
          </button>
          <button className="home-stat" onClick={() => onGo("binder")}>
            <span className="home-stat-num">{money(total, cur)}</span>
            <span className="home-stat-label">{t("est. value")}</span>
          </button>
          <button className="home-stat" onClick={() => onGo("wishlist")}>
            <span className="home-stat-num">{wishlist.length}</span>
            <span className="home-stat-label">{t("wishlist")}</span>
          </button>
          <button className="home-stat" onClick={() => onGo("today")}>
            <span className="home-stat-num">☀️</span>
            <span className="home-stat-label">{t("briefing")}</span>
          </button>
        </div>
      )}

      <h2 className="home-section">{t("What you can do")}</h2>
      <div className="home-features">
        {features.map((f, i) => (
          <div className="card home-feature" key={i}>
            <div className="home-feature-icon">{f.icon}</div>
            <div className="home-feature-title">{f.title}</div>
            <div className="home-feature-body">{f.body}</div>
          </div>
        ))}
      </div>

      <div className="card home-foot">
        <p className="muted" style={{ margin: 0 }}>
          {t("Values and outlooks are AI estimates from your photo plus live data — a smart starting point, not a market feed. Always sanity-check before a big trade.")}
        </p>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          <a href="/faq.html" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{t("FAQ")}</a>
          {" · "}
          <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{t("Privacy Policy")}</a>
        </p>
      </div>
    </div>
  );
}
