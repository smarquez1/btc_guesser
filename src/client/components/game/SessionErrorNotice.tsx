import { Button } from "@/components/ui/button";
import type { ApiError } from "@/game/types";
import { copy, sessionErrorMessage } from "./copy";

interface SessionErrorNoticeProps {
  error: ApiError | null;
  onRetry: () => void;
}

/**
 * Session load/restore failure. This is a retry state, not onboarding — the
 * player's game may still exist on the server.
 */
export function SessionErrorNotice({
  error,
  onRetry,
}: SessionErrorNoticeProps) {
  return (
    <section
      aria-labelledby="session-error-heading"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center"
    >
      <h2
        id="session-error-heading"
        className="text-xl font-semibold tracking-tight"
      >
        {copy.session.errorHeading}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {sessionErrorMessage(error)}
      </p>
      {error?.requestId ? (
        <p className="text-xs text-muted-foreground">
          {copy.session.reference(error.requestId)}
        </p>
      ) : null}
      <Button type="button" onClick={onRetry} className="mt-2">
        {copy.session.retry}
      </Button>
    </section>
  );
}
