# Card·Scanner — AI trading card appraiser

Scan a trading card with your phone or webcam and get an instant, AI-powered
breakdown: what it is, what it's worth, the stats casual collectors miss, how
good it is to own right now, and which comparable cards make smart trades.

Works across **Pokémon, baseball, soccer, cricket, basketball, football, and
hockey** cards. Powered by Google **Gemini** (`gemini-2.5-flash`) with vision —
which has a **free tier**.

## What it does

- **Scan a card** → identifies player/subject, manufacturer, set, year, card
  number, parallels/refractors, autographs, relics, rookie cards, short prints,
  and serial numbering — then estimates a value range and an overall rating.
- **Stats you might not notice** — print runs, scarcity, why a parallel matters,
  condition sensitivity.
- **Player outlook** — whether the player is rising, stable, or declining, and
  what that means for the card (e.g. "he's heating up — trade toward someone
  with more upside").
- **Good trades to chase** — comparable cards/players worth targeting (scan a
  Kyle Schwarber, it might point you toward a Julio Rodríguez).
- **Trade check** — describe both sides of a proposed trade and get a fairness
  verdict with value ranges and suggestions.
- **Chat** — open a chat to ask follow-up questions; your scanned card is used
  as context.

## Filters & custom instructions (Settings)

- A category you mostly collect, and your currency.
- A **minimum value** floor — e.g. "don't recommend anything under 150."
- Exclude **minor-league players / unproven prospects**.
- Skip **rookie cards** and favor veterans.
- Free-text **custom instructions** — including **blocking brands** in plain
  English ("never recommend Panini or Donruss cards").

Settings are saved in your browser and applied to every scan, trade check, and
chat.

## Setup

You need a **free** Google Gemini API key: https://aistudio.google.com/apikey
(sign in with a Google account — no billing required to start).

```bash
# 1. Add your key
cp .env.example .env        # then edit .env and set GEMINI_API_KEY

# 2. Install everything (root, server, and web)
npm install

# 3. Run the API server + web app together
npm run dev
```

- Web app: http://localhost:5173
- API server: http://localhost:8787 (the web dev server proxies `/api` to it)

The server reads `GEMINI_API_KEY` from `.env` at the repo root (via `dotenv`).

### Production build

```bash
npm run build      # builds the web app to web/dist
npm start          # runs the API server (serve web/dist with any static host)
```

## How it's built

```
server/   Express API + @google/genai
  src/index.ts      routes: /api/scan, /api/trade, /api/chat, /api/health
  src/gemini.ts     Gemini client + model config
  src/prompts.ts    system prompts + filter/custom-instruction handling
  src/schemas.ts    Gemini responseSchema definitions for structured output
web/      Vite + React UI
  src/components/    ScanView, ResultCard, TradeView, SettingsView, ChatDrawer
```

- **Scanning** uses Gemini vision with a JSON **structured output**
  (`responseSchema`), so results parse reliably.
- **Live data:** Google Search **grounding** is on by default, so player
  outlook and values reflect current form and recent sales — not the model's
  early-2025 training cutoff. Scans/trades run as two quick passes (grounded
  research → structured formatting) since Gemini can't combine search with
  strict JSON in one call. Disable with `CARD_SCANNER_GROUNDING=false` in
  `.env` (faster, one fewer call, but stale knowledge).
- **Chat** is **streamed** token-by-token over Server-Sent Events, also with
  live grounding.

Want a different model? Set `CARD_SCANNER_MODEL` in `.env` (e.g.
`gemini-2.0-flash`). To switch providers entirely (Groq, Mistral, OpenRouter),
only `server/src/gemini.ts` and `server/src/index.ts` need changes.

## Notes

Values and player outlooks are estimates from the model's knowledge and a
single photo — not a live market feed. The app flags low-confidence reads and
possible reprint/counterfeit signs in a "Heads up" section. Don't store secrets
in custom instructions.
