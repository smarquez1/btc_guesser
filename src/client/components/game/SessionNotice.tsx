import { Button } from "@/components/ui/button";
import type { ApiError } from "@/game/types";
import { copy, sessionErrorMessage } from "./copy";

interface SessionNoticeProps {
  error: ApiError;
  onRetry: () => void;
}

/**
 * Non-blocking notice for a background refresh/session-recovery failure while a
 * player is already known. Keeps the score, price, and guess state visible and
 * offers a manual retry instead of replacing the game with the blocking error
 * screen. Announced politely; never erases known state.
 */
export function SessionNotice({ error, onRetry }: SessionNoticeProps) {
  return (
    <div
      role="status"
      className="flex w-full items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-left"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-destructive">{sessionErrorMessage(error)}</p>
        {error.requestId ? (
          <p className="text-xs text-muted-foreground">
            {copy.session.reference(error.requestId)}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="shrink-0"
      >
        {copy.session.retry}
      </Button>
    </div>
  );
}
