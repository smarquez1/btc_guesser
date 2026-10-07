// Shared server diagnostics.
//
// One module owns the throttled degrade/recover core that the player, resolver,
// and pricing reporters previously duplicated across three files. One throttle
// slot per key, so a healthy operation never announces another's recovery.
// Fixed fields only: raw errors, provider payloads, prices, names, credentials,
// records, and identifiers never reach these fields.

import type { FastifyRequest } from "fastify";
import type { StructuredLog } from "./log.js";

export type DiagnosticLevel = "info" | "warn" | "error";

// Shared log throttle: suppress repeats within a window and let recovery
// re-arm the slot once. Callers use distinct keys per operation.
function createLogThrottle(now: () => number, windowMs = 60_000) {
  const lastLoggedAt = new Map<string, number>();
  return {
    // True when `key` may log now; records the time. Repeats within the window are suppressed.
    allow(key: string): boolean {
      const time = now();
      const previous = lastLoggedAt.get(key);
      if (previous !== undefined && time - previous < windowMs) return false;
      lastLoggedAt.set(key, time);
      return true;
    },
    // Clears `key`; returns whether it was armed, so recovery logs exactly once.
    clear(key: string): boolean {
      return lastLoggedAt.delete(key);
    },
  };
}

/**
 * The shared throttle-and-recover pattern. `degraded` emits at most once per
 * window per key; `recovered` emits once and only when a degraded log was armed.
 * Callers supply their own fields/level/destination through the callback.
 */
export function createDiagnosticSlots(now: () => number) {
  const throttle = createLogThrottle(now);
  return {
    degraded(key: string, emit: () => void): void {
      if (throttle.allow(key)) emit();
    },
    recovered(key: string, emit: () => void): boolean {
      if (!throttle.clear(key)) return false;
      emit();
      return true;
    },
  };
}

type PlayerOperation =
  | "storage_read"
  | "storage_create"
  | "storage_accept"
  | "price"
  | "request";
type PlayerCategory =
  | "persistence_failure"
  | "persistence_unconfigured"
  | "price_unavailable"
  | "price_failure"
  | "request_failure";

export function playerDiagnostics(now: () => number) {
  // Separate read/write slots prevent a good read from announcing write recovery.
  const slots = createDiagnosticSlots(now);
  return {
    failed(
      request: FastifyRequest,
      operation: PlayerOperation,
      category: PlayerCategory,
    ) {
      slots.degraded(operation, () => {
        const fields = {
          event: "player_operation_degraded",
          category,
          operation,
          requestId: request.id,
        };
        if (
          category === "persistence_failure" ||
          category === "request_failure"
        )
          request.log.error(
            fields,
            "Player operation failed; check dependency health/configuration",
          );
        else
          request.log.warn(
            fields,
            "Player operation unavailable; check configuration/provider health",
          );
      });
    },
    recovered(request: FastifyRequest, operation: PlayerOperation) {
      slots.recovered(operation, () => {
        request.log.info(
          {
            event: "player_operation_recovered",
            category: "recovery",
            operation,
            requestId: request.id,
          },
          "Player operation recovered",
        );
      });
    },
  };
}

export type ResolverOperation = "discovery" | "resolution" | "provider";

interface DegradedDetails {
  jobId: string;
  elapsedMs: number;
  retryInMs: number;
}

interface ResumedCounts {
  due: number;
  resolved: number;
  conflicts: number;
  elapsedMs: number;
}

// Fixed-field resolver diagnostics. Raw errors, provider payloads, prices,
// player/guess identifiers, and records must never reach these fields.
export function resolverDiagnostics(
  now: () => number,
  log: StructuredLog | undefined,
  runId: string,
) {
  // One slot per operation: a healthy operation never announces another's recovery.
  const slots = createDiagnosticSlots(now);
  const conflictThrottle = createLogThrottle(now);
  let conflictTotal = 0;
  return {
    started(pollMs: number, batchLimit: number) {
      log?.info(
        {
          event: "resolver_started",
          category: "lifecycle",
          runId,
          pollMs,
          batchLimit,
        },
        "Resolver started",
      );
    },
    stopped() {
      log?.info(
        { event: "resolver_stopped", category: "lifecycle", runId },
        "Resolver stopped",
      );
    },
    resumed(jobId: string, counts: ResumedCounts) {
      log?.info(
        {
          event: "resolver_resumed",
          category: "recovery",
          runId,
          jobId,
          due: counts.due,
          resolved: counts.resolved,
          conflicts: counts.conflicts,
          elapsedMs: counts.elapsedMs,
        },
        "Resolver resumed persisted guesses",
      );
    },
    degraded(operation: ResolverOperation, details: DegradedDetails) {
      slots.degraded(operation, () => {
        const fields = {
          event: "resolver_operation_degraded",
          category:
            operation === "provider"
              ? "provider_failure"
              : "persistence_failure",
          operation,
          runId,
          jobId: details.jobId,
          retryInMs: details.retryInMs,
          elapsedMs: details.elapsedMs,
        };
        if (operation === "provider")
          log?.warn(fields, "Resolver provider degraded");
        else log?.error(fields, "Resolver persistence degraded");
      });
    },
    recovered(operation: ResolverOperation, jobId: string) {
      slots.recovered(operation, () => {
        log?.info(
          {
            event: "resolver_operation_recovered",
            category: "recovery",
            operation,
            runId,
            jobId,
          },
          "Resolver operation recovered",
        );
      });
    },
    conflicts(count: number) {
      conflictTotal += count;
      if (!conflictThrottle.allow("conflict")) return;
      const fields = {
        event: "resolver_conflicts",
        category: "expected",
        runId,
        count: conflictTotal,
      };
      conflictTotal = 0;
      log?.info(fields, "Resolver conflicts (expected)");
    },
  };
}
