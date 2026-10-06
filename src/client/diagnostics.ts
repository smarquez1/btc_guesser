// Privacy-preserving client diagnostics.
//
// This is a bounded, dependency-free local reporter: no telemetry SDK and no
// network endpoint. It emits a fixed allowlist of fields and never accepts
// names, cookies, credentials, request bodies, or raw payloads.

import type { ApiError, DiagnosticCategory } from "@/game/types";

export interface DiagnosticEvent {
  category: DiagnosticCategory;
  operation: "session" | "create-player" | "submit-guess" | "refresh";
  requestId: string | null;
  status?: number | null;
}

export interface Diagnostics {
  report(event: DiagnosticEvent): void;
  reset(): void;
}

export interface DiagnosticsOptions {
  enabled?: boolean;
  now?: () => number;
  windowMs?: number;
  sink?: (
    message: string,
    fields: Record<string, string | number | null>,
  ) => void;
}

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Creates a rate-limited diagnostics reporter. Repeats of the same
 * `operation:category` pair within `windowMs` are dropped rather than buffered.
 */
export function createDiagnostics(
  options: DiagnosticsOptions = {},
): Diagnostics {
  const enabled = options.enabled ?? false;
  const clock = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const sink =
    options.sink ??
    ((message, fields) => {
      console.info(message, fields);
    });

  const lastEmittedAt = new Map<string, number>();

  const report = (event: DiagnosticEvent): void => {
    if (!enabled) return;

    const key = `${event.operation}:${event.category}`;
    const at = clock();
    const previous = lastEmittedAt.get(key);
    if (previous !== undefined && at - previous < windowMs) return;
    lastEmittedAt.set(key, at);

    // Allowlisted fields only; anything else on the event is ignored.
    const fields: Record<string, string | number | null> = {
      category: event.category,
      operation: event.operation,
      requestId: event.requestId ?? null,
    };
    if (event.status !== undefined) {
      fields.status = event.status;
    }

    sink(
      `BTC Guesser diagnostic: ${event.category} during ${event.operation}`,
      fields,
    );
  };

  const reset = (): void => {
    lastEmittedAt.clear();
  };

  return { report, reset };
}

/** Maps a classified `ApiError` to the diagnostic event shape. */
export function reportableError(
  error: ApiError,
  operation: DiagnosticEvent["operation"] = "session",
): DiagnosticEvent {
  return {
    category: error.category,
    operation,
    requestId: error.requestId,
    status: error.status,
  };
}
