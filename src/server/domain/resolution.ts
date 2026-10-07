import {
  comparePrices,
  isFresh,
  type PriceObservation,
} from "../pricing/policy.js";
import type { GuessResolution, PendingGuess } from "./player.js";

// Pure guess resolution: no clock, provider, or storage access.
// The provider trade timestamp is market-data context; eligibility requires the
// server acceptance deadline, a post-deadline receipt, and decision-time freshness.
// A differing post-deadline observation decides even if the move began earlier:
// the rule's two conditions ("the price changes" and "at least 60 seconds have
// passed") are both satisfied once they hold together at the check. A move that
// reverts before the check is never observed, and stale/unavailable data never
// resolves. This interpretation is deliberate and documented in the README.
export function resolveGuess(
  guess: PendingGuess,
  observation: PriceObservation,
  now: number,
): GuessResolution | null {
  if (
    now < guess.eligibleAt ||
    observation.receivedAt < guess.eligibleAt ||
    !isFresh(observation, now)
  )
    return null;
  const comparison = comparePrices(observation.price, guess.startingPrice);
  if (comparison === 0) return null;
  const correct = guess.direction === "up" ? comparison > 0 : comparison < 0;
  return {
    result: correct ? "correct" : "incorrect",
    scoreDelta: correct ? 1 : -1,
    resolvedAt: now,
    observedPrice: observation.price,
    observedAt: observation.receivedAt,
  };
}
