import { copy } from "./copy";

/** Calm, centered loading state while the session is being checked. */
export function SessionLoading() {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground"
      />
      <p className="text-base text-muted-foreground">{copy.session.loading}</p>
    </div>
  );
}
