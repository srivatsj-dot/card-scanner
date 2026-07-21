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
    idConfidence: { ...NUM, description: "How sure you are of the IDENTIFICATION (player, set, year, number, parallel), on a 1-10 scale. 10 = certain (clear photo, corroborated by eBay/reverse-image matches); 1 = a wild guess. Base it on photo clarity AND whether the eBay image-search titles and reverse-image results AGREE with what you read. Lower it when signals conflict or the card is blurry/obscured." },
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
    pokemon: {
      type: "OBJECT",
      nullable: true,
      description: "Pokémon-card-specific details. Null for non-Pokémon cards.",
      properties: {
        setNumber: { ...nullableStr, description: "Collector number as printed, e.g. '058/198' or 'SWSH284'." },
        rarity: { ...nullableStr, description: "Rarity, e.g. Common, Holo Rare, Double Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, Secret/Gold." },
        variant: { ...nullableStr, description: "Finish/type, e.g. Non-holo, Holofoil, Reverse Holo, Full Art, Alt Art, V, VMAX, VSTAR, ex, GX, Trainer Gallery." },
        edition: { ...nullableStr, description: "Vintage edition: '1st Edition', 'Shadowless', or 'Unlimited'." },
        hp: nullableStr,
        types: { ...nullableStr, description: "Energy type(s), e.g. Fire, Water." },
        stage: { ...nullableStr, description: "Basic, Stage 1, Stage 2, etc." },
        language: { ...nullableStr, description: "English or Japanese (or other)." },
        regulationMark: { ...nullableStr, description: "Modern regulation mark letter, e.g. F, G, H." },
      },
      required: ["setNumber", "rarity", "variant", "edition", "hp", "types", "stage", "language", "regulationMark"],
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
    "idConfidence",
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
    "pokemon",
    "recommendedTrades",
    "similarValueTargets",
    "generalAssessment",
    "warnings",
  ],
} as const;

// Bulk scan: one image may hold several cards. Return one lean entry per card.
export const bulkSchema = {
  type: "OBJECT",
  properties: {
    cards: {
      type: "ARRAY",
      description: "One entry for EACH distinct trading card visible in the image(s).",
      items: {
        type: "OBJECT",
        properties: {
          identified: { type: "BOOLEAN", description: "Whether this is a real, identifiable trading card." },
          player: nullableStr,
          sport: nullableStr,
          team: nullableStr,
          year: nullableStr,
          manufacturer: nullableStr,
          setName: nullableStr,
          cardNumber: nullableStr,
          parallel: nullableStr,
          specialEdition: nullableStr,
          serialNumber: nullableStr,
          estimatedValue: {
            type: "OBJECT",
            properties: { low: NUM, mid: NUM, high: NUM, currency: STR, note: STR },
            required: ["low", "mid", "high", "currency", "note"],
          },
          conditionGrade: { ...nullableStr, description: "Rough condition label if clearly visible, else null." },
          note: { ...STR, description: "One-line take on the card." },
        },
        required: [
          "identified", "player", "sport", "team", "year", "manufacturer", "setName",
          "cardNumber", "parallel", "specialEdition", "serialNumber", "estimatedValue",
          "conditionGrade", "note",
        ],
      },
    },
  },
  required: ["cards"],
} as const;

// Trade-up path: a chain of fair trades from owned cards toward a target.
const STR_ARR = { type: "ARRAY", items: STR } as const;
export const tradeUpSchema = {
  type: "OBJECT",
  properties: {
    feasible: { type: "BOOLEAN", description: "Whether a realistic path to the target exists from what they own." },
    steps: {
      type: "ARRAY",
      description: "Ordered trade steps, each climbing toward the target.",
      items: {
        type: "OBJECT",
        properties: {
          giveUp: { ...STR_ARR, description: "Card(s) to trade away this step." },
          receive: { ...STR, description: "The single card to receive this step." },
          valueNote: { ...STR, description: "Rough value on each side." },
          rationale: { ...STR, description: "Why the other side would accept." },
        },
        required: ["giveUp", "receive", "valueNote", "rationale"],
      },
    },
    summary: { ...STR, description: "Plain-language summary of the whole path." },
    note: { ...STR, description: "Caveats, or why it's infeasible." },
  },
  required: ["feasible", "steps", "summary", "note"],
} as const;

// Daily morning digest, grouped by sport/category.
export const digestSchema = {
  type: "OBJECT",
  properties: {
    overview: { ...STR, description: "One-line energetic summary of the day across the hobby." },
    yourCards: { ...STR_ARR, description: "What's happening to the collector's OWN players/cards (binder)." },
    yourWishlist: { ...STR_ARR, description: "What's happening to cards/players on the collector's WISHLIST." },
    sections: {
      type: "ARRAY",
      description: "One section per requested category.",
      items: {
        type: "OBJECT",
        properties: {
          sport: STR,
          risingStars: STR_ARR,
          declining: STR_ARR,
          storylines: { ...STR_ARR, description: "Team momentum, streaks, playoff/award races." },
          trades: { ...STR_ARR, description: "Recent/midseason trades, signings, call-ups, debuts." },
          chase: { ...STR_ARR, description: "Timely, reasoned cards/players to buy now." },
          news: { ...STR_ARR, description: "Set releases, notable sales, grading/market news." },
        },
        required: ["sport", "risingStars", "declining", "storylines", "trades", "chase", "news"],
      },
    },
  },
  required: ["overview", "yourCards", "yourWishlist", "sections"],
} as const;

export const tradeSchema = {
  type: "OBJECT",
  properties: {
    fairness: { ...STR, description: "Exactly one of: fair, favors_you, favors_them. Use 'fair' when the two sides are within ~20% in overall worth; only pick a direction when one side is clearly ahead. Do NOT output 'lopsided' or any other value." },
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
    valueGapNote: { ...STR, description: "Who comes out ahead overall and WHY — weigh value plus trajectory, scarcity, demand, and condition. Plain terms, never a tiny falsely-precise dollar figure." },
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

// Second-pass price verification: re-check a draft value against recent SOLD
// comps and correct it.
export const priceVerifySchema = {
  type: "OBJECT",
  properties: {
    low: { ...NUM, description: "Verified low of the recent sold range." },
    mid: { ...NUM, description: "Verified typical/median recent sold price." },
    high: { ...NUM, description: "Verified high of the recent sold range." },
    currency: STR,
    confidence: { ...STR, description: "high, medium, or low — how solid the comps are." },
    comps: { type: "ARRAY", items: STR, description: "The specific recent sold comps you found (e.g. 'eBay sold $4.50, Jun 2026')." },
    note: { ...STR, description: "One line on what the value is based on, in plain terms." },
  },
  required: ["low", "mid", "high", "currency", "confidence", "comps", "note"],
} as const;
// report the base-set size and the notable cards they're still missing.
export const checklistSchema = {
  type: "OBJECT",
  properties: {
    setName: { ...STR, description: "Canonical set name, e.g. '2023 Topps Chrome Baseball'." },
    baseSetSize: { ...NUM, description: "Number of cards in the BASE set (e.g. 220). 0 if genuinely unknown." },
    sizeConfidence: { ...STR, description: "high, medium, or low — how sure you are of the base-set size." },
    notableMissing: {
      type: "ARRAY",
      description: "The most sought-after cards in this set the collector does NOT own (rookies, stars, short prints), most valuable first. Up to 12.",
      items: {
        type: "OBJECT",
        properties: {
          cardNumber: { ...STR, description: "Card number in the set, e.g. '150' or 'US300'." },
          player: STR,
          note: { ...STR, description: "Why it matters — rookie, star, short print, etc." },
          estimatedValue: { ...STR, description: "Rough base-card value range in the collector's currency." },
        },
        required: ["cardNumber", "player", "note", "estimatedValue"],
      },
    },
    summary: { ...STR, description: "One-line take on the set and how close they are." },
  },
  required: ["setName", "baseSetSize", "sizeConfidence", "notableMissing", "summary"],
} as const;
