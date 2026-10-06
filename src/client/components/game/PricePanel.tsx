import { derivePriceDisplay } from "@/game/price-display";
import type { PlayerState, Pricing } from "@/game/types";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { formatUsdPrice } from "./format";

interface PricePanelProps {
  player: PlayerState;
}

/**
 * The latest BTC/USD price, always visible so the player can see the current
 * market in every play state. It is tinted by the last resolved move only
 * between rounds; a missing observation is never replaced with a fabricated
 * number.
 */
export function PricePanel({ player }: PricePanelProps) {
  const display = derivePriceDisplay(player);
  const disclosure = priceDisclosure(player.pricing);
  return (
    <section
      aria-labelledby="price-label"
      className="flex flex-col items-center gap-3 text-center"
    >
      <p id="price-label" className="text-base text-muted-foreground">
        {copy.price.labelLive}
      </p>
      {display.price !== null ? (
        <p
          className={cn(
            "text-5xl leading-none font-semibold tracking-tight tabular-nums whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none sm:text-[80px]",
            display.movement === "up" &&
              "text-emerald-700 dark:text-emerald-400",
            display.movement === "down" && "text-destructive",
          )}
        >
          {formatUsdPrice(display.price)}
          {display.movement ? (
            <span
              role="img"
              aria-label={
                display.movement === "up"
                  ? copy.price.ariaHigher
                  : copy.price.ariaLower
              }
              className="ml-2 align-middle text-2xl leading-none sm:text-3xl"
            >
              {display.movement === "up" ? "▲" : "▼"}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-3xl leading-tight font-semibold text-muted-foreground sm:text-4xl">
          {copy.price.unavailableValue}
        </p>
      )}
      {disclosure ? (
        <p className="text-sm text-muted-foreground">{disclosure}</p>
      ) : null}
    </section>
  );
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
