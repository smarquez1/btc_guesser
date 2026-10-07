import type { LatestGuess, PlayerState, Pricing } from "@/game/types";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { formatUsdPrice } from "./format";

interface PricePanelProps {
  player: PlayerState;
}

type PriceMovement = "up" | "down" | null;

/**
 * The latest BTC/USD price, always visible so the player can see the current
 * market in every play state. It is tinted by the last resolved move only
 * between rounds; a missing observation is never replaced with a fabricated
 * number.
 */
export function PricePanel({ player }: PricePanelProps) {
  const observation = player.pricing.observation;
  const price = observation ? observation.price : null;
  const movement = movementOf(player);
  return (
    <section
      aria-labelledby="price-label"
      className="flex flex-col items-center gap-3 text-center"
    >
      <p id="price-label" className="text-base text-muted-foreground">
        {copy.price.labelLive}
      </p>
      {price !== null ? (
        <p
          className={cn(
            "text-5xl leading-none font-semibold tracking-tight tabular-nums whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none sm:text-[80px]",
            movement === "up" && "text-emerald-700 dark:text-emerald-400",
            movement === "down" && "text-destructive",
          )}
        >
          {formatUsdPrice(price)}
          {movement ? (
            <span
              role="img"
              aria-label={
                movement === "up" ? copy.price.ariaHigher : copy.price.ariaLower
              }
              className="ml-2 align-middle text-2xl leading-none sm:text-3xl"
            >
              {movement === "up" ? "▲" : "▼"}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-3xl leading-tight font-semibold text-muted-foreground sm:text-4xl">
          {copy.price.unavailableValue}
        </p>
      )}
      {priceDisclosure(player.pricing) ? (
        <p className="text-sm text-muted-foreground">
          {priceDisclosure(player.pricing)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Display-only tint direction, taken from the server's resolved outcome rather
 * than by re-comparing prices on the client. `null` is neutral: no resolved
 * move to show, an active round, or equal prices.
 */
function movementOf(player: PlayerState): PriceMovement {
  if (player.activeGuess !== null || player.latestGuess === null) {
    return null;
  }
  return isHigher(player.latestGuess) ? "up" : "down";
}

function isHigher(guess: LatestGuess): boolean {
  // The server's result already encodes the price direction relative to the
  // guessed direction, so no exact price comparison is duplicated here.
  return (guess.result === "correct") === (guess.direction === "up");
}

function priceDisclosure(pricing: Pricing): string | null {
  if (pricing.observation === null) {
    return copy.price.unavailableHint;
  }
  if (pricing.status === "stale") {
    return copy.price.staleHint;
  }
  return null;
}
