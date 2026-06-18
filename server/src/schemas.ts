// Response schemas in Gemini's `responseSchema` format (OpenAPI-subset).
// Gemini does not support `additionalProperties` or union types, so nullable
// fields use `nullable: true` with a single type.

const STR = { type: "STRING" } as const;
const NUM = { type: "NUMBER" } as const;
const nullableStr = { type: "STRING", nullable: true } as const;

export const scanSchema = {
  type: "OBJECT",
  properties: {
    identified: {
      type: "BOOLEAN",
      description: "Whether a trading card was confidently identified in the image.",
    },
    player: { ...nullableStr, description: "Player or subject name." },
    sport: { ...nullableStr, description: "Category, e.g. Baseball, Basketball, Pokémon, Soccer, Cricket." },
    team: nullableStr,
    year: nullableStr,
    manufacturer: { ...nullableStr, description: "e.g. Topps, Panini, Bowman, Upper Deck." },
    setName: { ...nullableStr, description: "Set / product name." },
    cardNumber: nullableStr,
    parallel: { ...nullableStr, description: "Parallel, refractor, or color variant if visible (e.g. 'Gold /50')." },
    specialEdition: { ...nullableStr, description: "Rookie, autograph, relic/patch, serial-numbered, short print, etc." },
    serialNumber: { ...nullableStr, description: "Serial numbering printed on the card, e.g. '12/99'." },
    estimatedCondition: { ...nullableStr, description: "Rough condition guess from a single photo." },
    conditionReport: {
      type: "OBJECT",
      description: "Condition assessment from the photo(s).",
      properties: {
        grade: { ...STR, description: "Overall condition label, e.g. 'Near Mint', 'EX', 'Played' (estimate)." },
        flaws: {
          type: "ARRAY",
          description: "Specific visible condition issues: corner whitening, edge chipping, surface scratches, print lines, off-centering, creases, gloss loss. Empty if none visible.",
          items: STR,
        },
        summary: { ...STR, description: "One-line condition summary, noting if photos limit confidence." },
      },
      required: ["grade", "flaws", "summary"],
    },
    estimatedValue: {
      type: "OBJECT",
      properties: {
        low: NUM,
        mid: NUM,
        high: NUM,
        currency: STR,
        note: { ...STR, description: "What drives the value and how confident the estimate is." },
      },
      required: ["low", "mid", "high", "currency", "note"],
    },
    rating: {
      type: "OBJECT",
      properties: {
        score: { ...NUM, description: "Overall desirability 0-100." },
        label: { ...STR, description: "Short verdict, e.g. 'Strong hold'." },
        summary: { ...STR, description: "One or two sentences on how good this card is overall." },
      },
      required: ["score", "label", "summary"],
    },
    hiddenInsights: {
      type: "ARRAY",
      description: "Non-obvious stats or facts a casual collector might miss.",
      items: {
        type: "OBJECT",
        properties: { label: STR, detail: STR },
        required: ["label", "detail"],
      },
    },
    playerOutlook: {
      type: "OBJECT",
      properties: {
        trend: { ...STR, description: "Exactly one of: rising, stable, declining, unknown." },
        summary: { ...STR, description: "How the player/subject is doing and what it means for this card." },
      },
      required: ["trend", "summary"],
    },
    recommendedTrades: {
      type: "ARRAY",
      description: "Comparable cards/players worth trading toward (upgrades or hot names), respecting the user's filters.",
      items: {
        type: "OBJECT",
        properties: {
          player: STR,
          cardSuggestion: { ...STR, description: "Which card of that player to target." },
          reason: STR,
          comparableValue: { ...STR, description: "Rough value range to expect." },
        },
        required: ["player", "cardSuggestion", "reason", "comparableValue"],
      },
    },
    similarValueTargets: {
      type: "ARRAY",
      description:
        "If the collector traded THIS card away, realistic SAME-VALUE cards to ask for in return that the other side would likely accept (fair 1-for-1 swaps). Respect the user's filters.",
      items: {
        type: "OBJECT",
        properties: {
          player: STR,
          cardSuggestion: { ...STR, description: "Specific card to ask for." },
          estimatedValue: { ...STR, description: "Rough value range, close to this card's value." },
          reason: { ...STR, description: "Why it's a fair, acceptable ask." },
        },
        required: ["player", "cardSuggestion", "estimatedValue", "reason"],
      },
    },
    generalAssessment: { ...STR, description: "Plain-language overall take on the card." },
    warnings: {
      type: "ARRAY",
      description: "Caveats: low photo confidence, possible reprint/counterfeit signs, volatile value.",
      items: STR,
    },
  },
  required: [
    "identified",
    "player",
    "sport",
    "team",
    "year",
    "manufacturer",
    "setName",
    "cardNumber",
    "parallel",
    "specialEdition",
    "serialNumber",
    "estimatedCondition",
    "conditionReport",
    "estimatedValue",
    "rating",
    "hiddenInsights",
    "playerOutlook",
    "recommendedTrades",
    "similarValueTargets",
    "generalAssessment",
    "warnings",
  ],
} as const;

export const tradeSchema = {
  type: "OBJECT",
  properties: {
    fairness: { ...STR, description: "Exactly one of: fair, favors_you, favors_them, lopsided." },
    verdict: { ...STR, description: "One-line headline judgment." },
    yourSide: {
      type: "OBJECT",
      properties: { valueLow: NUM, valueHigh: NUM, notes: STR },
      required: ["valueLow", "valueHigh", "notes"],
    },
    theirSide: {
      type: "OBJECT",
      properties: { valueLow: NUM, valueHigh: NUM, notes: STR },
      required: ["valueLow", "valueHigh", "notes"],
    },
    valueGapNote: { ...STR, description: "Who comes out ahead and by roughly how much." },
    reasoning: { ...STR, description: "Why the trade is or isn't fair, including trajectory and upside." },
    suggestions: {
      type: "ARRAY",
      description: "Ways to even out or improve the deal.",
      items: STR,
    },
  },
  required: ["fairness", "verdict", "yourSide", "theirSide", "valueGapNote", "reasoning", "suggestions"],
} as const;

// "What should I ask for?" — given the cards the collector is giving up,
// suggest fair same-value cards the other side would likely accept.
export const askSchema = {
  type: "OBJECT",
  properties: {
    givingValueNote: { ...STR, description: "Combined estimated value of everything the collector is giving up." },
    targets: {
      type: "ARRAY",
      description: "Cards to ask for in return — realistic, similar total value, likely to be accepted. Respect the user's filters.",
      items: {
        type: "OBJECT",
        properties: {
          player: STR,
          cardSuggestion: { ...STR, description: "Specific card(s) to ask for." },
          estimatedValue: { ...STR, description: "Rough value range." },
          reason: STR,
          likelihood: { ...STR, description: "How likely the other side accepts: high, medium, or a stretch." },
        },
        required: ["player", "cardSuggestion", "estimatedValue", "reason", "likelihood"],
      },
    },
    note: { ...STR, description: "Any caveats or strategy for making the ask." },
  },
  required: ["givingValueNote", "targets", "note"],
} as const;
