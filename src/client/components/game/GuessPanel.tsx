import { Button } from "@/components/ui/button";
import type { ApiError, Direction, PlayerState } from "@/game/types";
import { cn } from "@/lib/utils";
import { ActionNotice } from "./ActionNotice";
import { copy } from "./copy";
import { LatestResult } from "./LatestResult";
import { PendingGuess } from "./PendingGuess";

interface GuessPanelProps {
  player: PlayerState;
  now: number;
  submitting: boolean;
  /**
   * Optimistic direction while a submission is in flight. Optional so callers
   * that have not yet wired it still render; absent means no optimistic press.
   */
  pendingDirection?: Direction | null;
  actionError: ApiError | null;
  onSubmit: (direction: Direction) => void;
  onDismissError: () => void;
}

/**
 * The play controls. The prompt and Up/Down buttons come first; the status slot
 * below them holds the active guess and/or latest result, so the actions stay on
 * top of the notification while state changes beneath them. An active guess or an
 * in-flight submission disables both buttons; failures surface in a dismissible
 * notice.
 *
 * The pressed button stays visually prominent while disabled: `aria-pressed`
 * exposes the state to assistive tech and the ring/opacity classes keep it
 * distinct instead of merely greyed out.
 */
export function GuessPanel({
  player,
  now,
  submitting,
  pendingDirection = null,
  actionError,
  onSubmit,
  onDismissError,
}: GuessPanelProps) {
  const pressedDirection = player.activeGuess?.direction ?? pendingDirection;
  const locked = submitting || player.activeGuess !== null;
  const pressedClasses = "ring-2 ring-ring ring-offset-2 disabled:opacity-100";
  return (
    <section
      aria-labelledby="guess-prompt"
      className="flex w-full max-w-[560px] flex-col items-center gap-5 self-center"
    >
      <h2 id="guess-prompt" className="text-center text-xl font-medium">
        {copy.guess.prompt}
      </h2>
      <div className="flex w-full max-w-[400px] gap-4">
        <Button
          type="button"
          className={cn(
            "h-[52px] flex-1 text-base font-medium",
            pressedDirection === "up" && pressedClasses,
          )}
          aria-pressed={pressedDirection === "up"}
          disabled={locked}
          onClick={() => {
            if (locked) return;
            onSubmit("up");
          }}
        >
          {copy.guess.up}
        </Button>
        <Button
          type="button"
          className={cn(
            "h-[52px] flex-1 text-base font-medium",
            pressedDirection === "down" && pressedClasses,
          )}
          aria-pressed={pressedDirection === "down"}
          disabled={locked}
          onClick={() => {
            if (locked) return;
            onSubmit("down");
          }}
        >
          {copy.guess.down}
        </Button>
      </div>
      {player.activeGuess ? (
        <PendingGuess guess={player.activeGuess} now={now} />
      ) : player.latestGuess ? (
        <LatestResult guess={player.latestGuess} />
      ) : null}
      {actionError ? (
        <ActionNotice error={actionError} onDismiss={onDismissError} />
      ) : null}
      <div className="flex flex-col gap-1.5 text-center text-sm text-muted-foreground">
        {copy.guess.rules.map((rule) => (
          <p key={rule}>{rule}</p>
        ))}
      </div>
    </section>
  );
}
