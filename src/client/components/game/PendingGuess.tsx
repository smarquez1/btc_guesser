import { Card, CardContent } from "@/components/ui/card";
import type { ActiveGuess } from "@/game/types";
import { remainingSeconds } from "@/game/types";
import { copy, directionWord } from "./copy";
import { formatUsdPrice } from "./format";
import { ArrowDownIcon, ArrowUpIcon } from "./icons";

interface PendingGuessProps {
  guess: ActiveGuess;
  now: number;
}

/**
 * The player's unresolved guess. The countdown is a display aid only — at zero
 * it switches to a general "waiting for the server" message and never implies
 * automatic resolution. Not announced live; the text changes every second.
 */
export function PendingGuess({ guess, now }: PendingGuessProps) {
  const remaining = remainingSeconds(guess.eligibleAt, now);
  const DirectionIcon = guess.direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <Card className="w-full gap-0 py-4">
      <CardContent className="flex flex-col items-center gap-2 px-4 text-center sm:px-5">
        <p className="flex items-center justify-center gap-2 text-base font-medium">
          <DirectionIcon className="size-4 shrink-0" />
          {copy.pending.title(
            directionWord(guess.direction),
            formatUsdPrice(guess.startingPrice),
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {remaining > 0
            ? copy.pending.waiting(remaining)
            : copy.pending.checking}
        </p>
      </CardContent>
    </Card>
  );
}
