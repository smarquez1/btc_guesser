import type { GuessResolution, PendingGuess } from "./players.js";
import { comparePrices, isFresh, type PriceObservation } from "./pricing.js";

// Pure guess resolution: no clock, provider, or storage access.
// The provider trade timestamp is market-data context; eligibility requires the
// server acceptance deadline, a post-deadline receipt, and decision-time freshness.
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
