import { Button } from "@/components/ui/button";
import type { ApiError } from "@/game/types";
import { actionErrorMessage, copy } from "./copy";

interface ActionNoticeProps {
  error: ApiError;
  onDismiss: () => void;
}

/**
 * Non-blocking, dismissible notice for a failed creation or guess submission.
 * Announced politely (role="status") and never replaces visible game state.
 */
export function ActionNotice({ error, onDismiss }: ActionNoticeProps) {
  return (
    <div
      role="status"
      className="flex w-full items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-left"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-destructive">{actionErrorMessage(error)}</p>
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
        onClick={onDismiss}
        className="shrink-0"
      >
        {copy.notice.dismiss}
      </Button>
    </div>
  );
}
