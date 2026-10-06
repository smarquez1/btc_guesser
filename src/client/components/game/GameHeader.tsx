import type { PlayerState } from "@/game/types";
import { copy } from "./copy";

interface GameHeaderProps {
  player: PlayerState | null;
}

/** Top bar: game title (the single h1) plus the signed-in player's name and score. */
export function GameHeader({ player }: GameHeaderProps) {
  return (
    <header className="flex w-full items-center justify-between gap-4">
      <h1 className="shrink-0 text-xl font-semibold tracking-tight">
        {copy.header.title}
      </h1>
      {player ? (
        <p className="flex min-w-0 items-baseline gap-2 text-base">
          <span className="truncate text-muted-foreground">
            {player.displayName}
          </span>
          <span className="shrink-0 font-medium">
            {copy.header.scoreLabel(player.score)}
          </span>
        </p>
      ) : null}
    </header>
  );
}
