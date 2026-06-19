# Card·Scanner

Point your phone (or webcam) at a trading card and it tells you what it is,
roughly what it's worth, and whether it's worth holding or flipping. I built it
because I kept pulling cards I didn't recognize and got tired of typing
half-remembered set names into eBay to guess a price.

It handles Pokémon, baseball, soccer, cricket, basketball, football, and hockey.
Under the hood it's Google Gemini with vision (`gemini-2.5-flash`), which has a
free tier — so you can run the whole thing without paying anyone.

## What you can do with it

- **Scan a card.** It works out the player, set, year, card number, parallels,
  autos, relics, rookies, short prints, serial numbering — then gives you a
  value range and a rating out of 100.
- **See the stuff you'd miss.** Print runs, why a particular parallel matters,
  how much condition is dragging the price around.
- **Check on the player.** Whether they're heating up or cooling off, and what
  that means for the card.
- **Get trade ideas.** Scan a Schwarber and it might nudge you toward a Julio
  Rodríguez of similar value. There's also a trade checker — punch in both sides
  and it'll tell you who's getting the better end.
- **Keep a binder and a wishlist.** Saved cards re-price themselves every day so
  you can watch them move. The wishlist tracks what you're hunting for.
- **Bulk scan.** Got a stack? Photograph several at once.
- **Ask questions.** There's a chat that already knows about the card you just
  scanned.
- **Earn achievements.** Little badges for milestones. Most are hidden until you
  unlock them — half the fun is finding out what they are.
- **Use it in your language.** The whole interface translates on the fly, not
  just a handful of labels.

## Settings worth knowing about

Tucked in Settings you can set the category you mostly collect, your currency,
and a few guardrails for recommendations — a minimum value floor, "no
minor-leaguers," "skip rookies," that sort of thing. There's also a free-text
box for anything else, which is the easiest way to block a brand you don't care
for ("never recommend Panini"). It all saves to your browser and applies
everywhere.

## Getting it running

You'll need a free Gemini API key from https://aistudio.google.com/apikey — sign
in with a Google account, no card required to start.

```bash
cp .env.example .env        # paste your key in as GEMINI_API_KEY
npm install                 # installs root, server, and web
npm run dev                 # starts the API and the web app together
```

Then open http://localhost:5173. The API runs on :8787 and the web dev server
proxies `/api` calls over to it. The key gets read from `.env` at the repo root.

To ship it:

```bash
npm run build      # web app builds to web/dist
npm start          # runs the API; serve web/dist with whatever static host you like
```

## How it's wired up

```
server/   Express + @google/genai
  src/index.ts      routes: /api/scan, /api/trade, /api/chat, /api/translate, /api/health
  src/gemini.ts     Gemini client + model config
  src/prompts.ts    the system prompts and how filters/instructions get folded in
  src/schemas.ts    the JSON shapes Gemini fills in
web/      Vite + React
  src/components/    the views — Scan, Result, Trade, Settings, Chat, etc.
  src/translator.ts  the on-the-fly UI translation
```

A few things that took some fiddling to get right:

- **Structured output.** Scans come back as JSON described by a `responseSchema`,
  so the UI never has to guess at the model's prose.
- **Live data.** Google Search grounding is on by default, so prices and player
  form aren't stuck at the model's training cutoff. Each scan is a single
  grounded call (Gemini won't do search *and* a strict schema at once, so the
  JSON gets asked for in the prompt). Set `CARD_SCANNER_GROUNDING=false` if you'd
  rather go faster and don't mind staler numbers.
- **Staying under the free tier.** The free quota is tight, especially for
  grounded calls. So every request tries `gemini-2.5-flash`, and if it gets rate
  limited it quietly falls back to `gemini-2.5-flash-lite` (different quota pool)
  and drops grounding if that's the thing that's capped. You get an answer that's
  a hair less sharp instead of an error. Turn on billing for the Google project
  if you want the limits to basically disappear.
- **Chat streams.** Token by token over server-sent events.

Want a different model? Set `CARD_SCANNER_MODEL` in `.env`. Switching providers
entirely would only touch `server/src/gemini.ts` and `server/src/index.ts`.

## A couple of honest caveats

The values and outlooks are educated guesses from the model plus one photo —
they're not a live market feed, so treat them as a starting point, not gospel.
When it isn't sure, it says so, and it'll flag anything that smells like a
reprint or fake in a "Heads up" box. And don't put anything secret in the custom
instructions — they get sent to the model with every request.
