import { Button } from "@/components/ui/button";
import type { ApiError } from "@/game/types";
import { copy } from "./copy";

interface NoticeProps {
  error: ApiError;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * Non-blocking, dismissible notice for a failed action or a background
 * refresh/session-recovery failure. Announced politely (role="status") and
 * never replaces visible game state.
 */
export function Notice({ error, message, actionLabel, onAction }: NoticeProps) {
  return (
    <div
      role="status"
      className="flex w-full items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-left"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-destructive">{message}</p>
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
        onClick={onAction}
        className="shrink-0"
      >
        {actionLabel}
      </Button>
    </div>
  );
}
