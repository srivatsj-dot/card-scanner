// JSON schemas for Claude structured outputs.
// Structured outputs require `additionalProperties: false` on every object and
// do not support numeric/length constraints, so we keep these plain.

export const scanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    identified: {
      type: "boolean",
      description: "Whether a trading card was confidently identified in the image.",
    },
    player: { type: ["string", "null"], description: "Player or subject name." },
    sport: { type: ["string", "null"], description: "Sport or category, e.g. Baseball, Basketball, Pokemon." },
    team: { type: ["string", "null"] },
    year: { type: ["string", "null"] },
    manufacturer: { type: ["string", "null"], description: "e.g. Topps, Panini, Bowman, Upper Deck." },
    setName: { type: ["string", "null"], description: "Set / product name." },
    cardNumber: { type: ["string", "null"] },
    parallel: {
      type: ["string", "null"],
      description: "Parallel, refractor, or color variant if visible (e.g. 'Gold /50', 'Prizm Silver').",
    },
    specialEdition: {
      type: ["string", "null"],
      description: "Notable special edition: rookie card, autograph, relic/patch, serial-numbered, short print, etc.",
    },
    serialNumber: { type: ["string", "null"], description: "Serial numbering if printed on the card, e.g. '12/99'." },
    estimatedCondition: {
      type: ["string", "null"],
      description: "Rough condition estimate from the photo (e.g. 'Near Mint', 'Played'). Note this is a guess from a single image.",
    },
    estimatedValue: {
      type: "object",
      additionalProperties: false,
      properties: {
        low: { type: "number" },
        mid: { type: "number" },
        high: { type: "number" },
        currency: { type: "string" },
        note: { type: "string", description: "What drives the value and how confident the estimate is." },
      },
      required: ["low", "mid", "high", "currency", "note"],
    },
    rating: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "number", description: "Overall desirability 0-100." },
        label: { type: "string", description: "Short verdict, e.g. 'Strong hold', 'Speculative'." },
        summary: { type: "string", description: "One or two sentences on how good this card is overall." },
      },
      required: ["score", "label", "summary"],
    },
    hiddenInsights: {
      type: "array",
      description: "Non-obvious stats or facts a casual collector might miss (print runs, population reports, why a parallel matters, etc.).",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
        },
        required: ["label", "detail"],
      },
    },
    playerOutlook: {
      type: "object",
      additionalProperties: false,
      properties: {
        trend: { type: "string", description: "One of: rising, stable, declining, unknown." },
        summary: { type: "string", description: "How the player/subject is doing and what it means for this card." },
      },
      required: ["trend", "summary"],
    },
    recommendedTrades: {
      type: "array",
      description: "Comparable cards/players worth trading toward, respecting the user's filters.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          player: { type: "string" },
          cardSuggestion: { type: "string", description: "Which card of that player to target, if relevant." },
          reason: { type: "string" },
          comparableValue: { type: "string", description: "Rough value range to expect." },
        },
        required: ["player", "cardSuggestion", "reason", "comparableValue"],
      },
    },
    generalAssessment: { type: "string", description: "Plain-language overall take on the card." },
    warnings: {
      type: "array",
      description: "Caveats: low photo confidence, possible reprint/counterfeit signs, volatile value, etc.",
      items: { type: "string" },
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
    "estimatedValue",
    "rating",
    "hiddenInsights",
    "playerOutlook",
    "recommendedTrades",
    "generalAssessment",
    "warnings",
  ],
} as const;

export const tradeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fairness: {
      type: "string",
      description: "One of: fair, favors_you, favors_them, lopsided.",
    },
    verdict: { type: "string", description: "One-line headline judgment." },
    yourSide: {
      type: "object",
      additionalProperties: false,
      properties: {
        valueLow: { type: "number" },
        valueHigh: { type: "number" },
        notes: { type: "string" },
      },
      required: ["valueLow", "valueHigh", "notes"],
    },
    theirSide: {
      type: "object",
      additionalProperties: false,
      properties: {
        valueLow: { type: "number" },
        valueHigh: { type: "number" },
        notes: { type: "string" },
      },
      required: ["valueLow", "valueHigh", "notes"],
    },
    valueGapNote: { type: "string", description: "Who comes out ahead and by roughly how much." },
    reasoning: { type: "string", description: "Why this trade is or isn't fair, including trajectory and upside." },
    suggestions: {
      type: "array",
      description: "Ways to even out or improve the deal.",
      items: { type: "string" },
    },
  },
  required: ["fairness", "verdict", "yourSide", "theirSide", "valueGapNote", "reasoning", "suggestions"],
} as const;
