// The plain-English answer to the question almost everyone actually has:
// "is this worth anything?"
//
// The valuation card below it already shows the number and the range. This says
// what the number MEANS, in the words someone who has never heard of a parallel
// would use — and what to do about it.
import type { ScanResult, CardGrade } from "./types";
import { convertMoney } from "./utils";

export type VerdictTone = "unknown" | "common" | "little" | "keep" | "valuable" | "big";

export interface Verdict {
  tone: VerdictTone;
  /** The answer, in one line. English — pass through t() before showing. */
  headline: string;
  /** What to do about it. Also English. */
  advice: string;
}

/** Words in a condition report that mean the card has real damage. */
const ROUGH = /(crease|creased|bend|bent|dent|tear|torn|writing|water|stain|damag|poor|heavily played|worn)/i;

/**
 * `graded` is the slab, if the collector has recorded one — a graded card is
 * already protected and already appraised, so the advice changes.
 */
export function plainVerdict(result: ScanResult, graded?: CardGrade | null): Verdict | null {
  if (!result || !result.identified) return null;

  if (result.ambiguous) {
    return {
      tone: "unknown",
      headline: "There are lots of different cards this could be.",
      advice: "The year and set name are usually printed on the back — add those and you'll get a real value for the exact one you're holding.",
    };
  }

  const v = result.estimatedValue;
  if (!v || typeof v.mid !== "number" || v.mid <= 0) return null;
  // Thresholds are in dollars, so convert whatever the appraisal came back in.
  const usd = convertMoney(v.mid, v.currency || "USD", "USD");
  const rough = ROUGH.test(result.estimatedCondition || "") || ROUGH.test(result.conditionReport?.summary || "");

  if (usd < 2) {
    return {
      tone: "common",
      headline: "This is a common card — it isn't worth much.",
      advice: "Cards like this were printed in huge numbers. It's not worth grading or selling on its own, but it's still a nice one to keep.",
    };
  }

  if (usd < 15) {
    return {
      tone: "little",
      headline: "It's worth a little, but not a lot.",
      advice: graded
        ? "It's already graded, so it's protected. Selling it on its own probably costs more in fees and postage than it's worth — cards like this do best sold as part of a bigger lot."
        : "Fine to keep, trade, or throw into a bundle. Professional grading costs more than the card is worth, so don't bother with it.",
    };
  }

  if (usd < 75) {
    return {
      tone: "keep",
      headline: "This one's worth holding on to.",
      advice: rough
        ? "The condition is holding it back — the damage can't be undone, so just keep it in a plastic sleeve and enjoy it."
        : "Put it in a plastic sleeve so the corners stay sharp. Condition is most of what a card like this is worth.",
    };
  }

  if (usd < 400) {
    return {
      tone: "valuable",
      headline: "This is a genuinely valuable card.",
      advice: graded
        ? "It's already graded, so it's both protected and proven. Keep the slab out of direct sunlight and don't let anyone talk you into a quick sale."
        : rough
          ? "Get it into a sleeve and a hard top-loader today. Grading isn't worth it with damage this visible, but the card still has real value."
          : "Get it into a sleeve and a hard top-loader today. If the corners and centring are sharp, professional grading could add a lot to what it's worth.",
    };
  }

  return {
    tone: "big",
    headline: "This is a big one — treat it carefully.",
    advice: graded
      ? "It's graded, so it's protected and proven. Worth adding to your home insurance, and worth getting more than one offer before you ever sell."
      : "Sleeve it, put it in a hard case, and keep it somewhere dry and dark. Get it professionally graded before you even think about selling, and never take the first offer.",
  };
}
