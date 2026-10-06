import { Card, CardContent } from "@/components/ui/card";
import type { LatestGuess } from "@/game/types";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { CheckIcon, XIcon } from "./icons";

interface LatestResultProps {
  guess: LatestGuess;
}

/**
 * The server-confirmed outcome of the most recent guess. Icon and explicit
 * wording carry the result — color is never the only signal — and the score
 * delta shown is the server's, not a local adjustment.
 */
export function LatestResult({ guess }: LatestResultProps) {
  const correct = guess.result === "correct";
  const ResultIcon = correct ? CheckIcon : XIcon;
  return (
    <Card role="status" className="w-full gap-0 py-4">
      <CardContent className="flex flex-col items-center gap-2 px-4 text-center sm:px-5">
        <p
          className={cn(
            "flex items-center justify-center gap-2 text-base font-medium",
            correct
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-destructive",
          )}
        >
          <ResultIcon className="size-4 shrink-0" />
          {correct ? copy.result.correct : copy.result.incorrect}
          <span aria-hidden="true">·</span>
          <span className="font-semibold">
            {guess.scoreDelta > 0
              ? copy.result.deltaPositive
              : copy.result.deltaNegative}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {correct ? copy.result.correctDetail : copy.result.incorrectDetail}
        </p>
      </CardContent>
    </Card>
  );
}
