import { useEffect, useState } from "react";
import type { TradeOffer } from "../types";
import { getOffer, respondOffer } from "../api";
import { useT } from "../translator";
import Logo from "./Logo";

// The public page a trade-offer link opens (/offer/<id>). The viewer is the
// RECIPIENT, so everything is flipped to their perspective: the sender's "give"
// is what the viewer would receive, and the fairness verdict (stored from the
// sender's point of view) is re-labeled for the viewer. No account needed.
export default function OfferView({ id }: { id: string }) {
  const t = useT();
  const [offer, setOffer] = useState<TradeOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    getOffer(id)
      .then(setOffer)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this offer."));
  }, [id]);

  async function respond(action: "accept" | "decline" | "change") {
    setBusy(true);
    setError(null);
    try {
      setOffer(await respondOffer(id, action, action === "change" ? note : undefined));
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your response.");
    } finally {
      setBusy(false);
    }
  }

  // Fairness from the VIEWER's (recipient's) perspective. favors_you in the
  // stored verdict means the SENDER comes out ahead — bad for the viewer.
  function viewerPill(f: string) {
    switch (f) {
      case "fair": return <span className="pill blue">{t("Fair — roughly even")}</span>;
      case "favors_you": return <span className="pill red">{t("Careful — you'd give more than you get")}</span>;
      case "favors_them": return <span className="pill green">{t("Good for you — you'd get more than you give")}</span>;
      default: return null;
    }
  }

  const done = offer && offer.status !== "pending" && offer.status !== "change_requested";

  return (
    <div className="app offer-page">
      <main className="content" style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block" }}><Logo size={44} /></div>
          <h1 style={{ margin: "8px 0 2px" }}>Card-O-Rama</h1>
          <p className="muted" style={{ margin: 0 }}>{t("Trade offer")}</p>
        </div>

        {error && !offer && <div className="card"><div className="error-box">{error}</div></div>}
        {!offer && !error && <div className="card"><p className="muted">{t("Loading offer…")}</p></div>}

        {offer && (
          <>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>
                🤝 {offer.from} {t("wants to trade with you")}
              </h2>
              <div className="grid2">
                <div>
                  <h3>📥 {t("You'd receive")}</h3>
                  <ul style={{ marginTop: 0 }}>
                    {offer.give.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                  {offer.trade && (
                    <div className="value-big" style={{ fontSize: 20 }}>
                      {offer.currency} {offer.trade.yourSide.valueLow}–{offer.trade.yourSide.valueHigh}
                    </div>
                  )}
                </div>
                <div>
                  <h3>📤 {t("You'd give")}</h3>
                  <ul style={{ marginTop: 0 }}>
                    {offer.get.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                  {offer.trade && (
                    <div className="value-big" style={{ fontSize: 20 }}>
                      {offer.currency} {offer.trade.theirSide.valueLow}–{offer.trade.theirSide.valueHigh}
                    </div>
                  )}
                </div>
              </div>
              {offer.trade && (
                <div style={{ marginTop: 10 }}>
                  {viewerPill(offer.trade.fairness)}
                  <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
                    {t("Values from recent eBay listings and real market comps.")} {offer.trade.valueGapNote}
                  </p>
                </div>
              )}
            </div>

            {done ? (
              <div className="card" style={{ textAlign: "center" }}>
                <h2 style={{ marginTop: 0 }}>
                  {offer.status === "accepted" ? `✅ ${t("You accepted this trade")}` : `✕ ${t("You declined this trade")}`}
                </h2>
                <p className="muted">
                  {offer.status === "accepted"
                    ? t("Tell") + ` ${offer.from} ` + t("— then swap the cards in person!")
                    : t("No worries — maybe next time.")}
                </p>
              </div>
            ) : (
              <div className="card">
                {offer.status === "change_requested" && (
                  <p className="muted" style={{ marginTop: 0 }}>
                    ✏️ {t("You asked for a change:")} “{offer.message}” — {t("you can still accept or decline.")}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" disabled={busy} onClick={() => respond("accept")}>
                    ✅ {t("Accept trade")}
                  </button>
                  <button className="btn secondary" disabled={busy} onClick={() => setAsking((a) => !a)}>
                    ✏️ {t("Ask for a change")}
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => respond("decline")}>
                    ✕ {t("Decline")}
                  </button>
                </div>
                {asking && (
                  <div style={{ marginTop: 12 }}>
                    <input
                      type="text"
                      value={note}
                      placeholder={t("What would make this work? e.g. add another card, swap X for Y")}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button
                      className="btn small"
                      style={{ marginTop: 8 }}
                      disabled={busy || !note.trim()}
                      onClick={() => respond("change")}
                    >
                      {t("Send request")}
                    </button>
                  </div>
                )}
                {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
              </div>
            )}

            <div className="card" style={{ textAlign: "center" }}>
              <p className="muted" style={{ margin: 0 }}>
                {t("Made with Card-O-Rama — scan your cards, price them with real eBay data, and trade smarter.")}
              </p>
              <a className="btn secondary small" href="/" style={{ marginTop: 10, display: "inline-block" }}>
                {t("Try it free")}
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
