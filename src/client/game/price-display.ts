import type { PlayerState } from "@/game/types";

/**
 * Display-only tint direction. `null` is neutral: no resolved move to show, or
 * equal prices.
 */
export type PriceMovement = "up" | "down" | null;

export interface PriceDisplay {
  price: string | null;
  movement: PriceMovement;
}

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** A positive plain decimal: the regex shape and at least one non-zero digit. */
function isPositivePlainDecimal(value: string): boolean {
  return PLAIN_DECIMAL.test(value) && /[1-9]/.test(value);
}

/**
 * Exact decimal comparison mirroring the server's `comparePrices`, but never
 * throwing: an invalid input on either side is treated as neutral (`0`). No
 * float conversion, rounding, or display formatting is involved.
 */
export function compareExactDecimals(a: string, b: string): -1 | 0 | 1 {
  if (!isPositivePlainDecimal(a) || !isPositivePlainDecimal(b)) {
    return 0;
  }
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(scale, "0"));
  const right = BigInt(bi + bf.padEnd(scale, "0"));
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * The big price is always the live latest observation, so the player can see
 * the current BTC/USD price in every play state. It is tinted by the last
 * resolved move only between rounds (no active guess): a new active guess
 * starts a fresh round and clears the tint.
 */
export function derivePriceDisplay(player: PlayerState): PriceDisplay {
  const observation = player.pricing.observation;
  const price = observation ? observation.price : null;
  let movement: PriceMovement = null;
  if (player.activeGuess === null && player.latestGuess !== null) {
    const { observedPrice, startingPrice } = player.latestGuess;
    movement = toMovement(compareExactDecimals(observedPrice, startingPrice));
  }
  return { price, movement };
}

function toMovement(result: -1 | 0 | 1): PriceMovement {
  if (result > 0) {
    return "up";
  }
  if (result < 0) {
    return "down";
  }
  return null;
}
