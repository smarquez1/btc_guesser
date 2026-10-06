import type { GuessResolution, PendingGuess } from "./players.js";
import { comparePrices, type PriceObservation } from "./pricing.js";

// Pure guess resolution: no clock, provider, or storage access.
// The provider trade timestamp is market-data context; only the server
// acceptance deadline and the observation's receipt time gate eligibility.
export function resolveGuess(
  guess: PendingGuess,
  observation: PriceObservation,
  now: number,
): GuessResolution | null {
  if (now < guess.eligibleAt || observation.receivedAt < guess.eligibleAt)
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
