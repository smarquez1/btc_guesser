import type { ResolverLog } from "./log.js";
import { createLogThrottle } from "./throttle.js";

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
  log: ResolverLog | undefined,
  runId: string,
) {
  // One slot per operation: a healthy operation never announces another's recovery.
  const throttle = createLogThrottle(now);
  let conflictTotal = 0;
  const conflictThrottle = createLogThrottle(now);
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
      if (!throttle.allow(operation)) return;
      const fields = {
        event: "resolver_operation_degraded",
        category:
          operation === "provider" ? "provider_failure" : "persistence_failure",
        operation,
        runId,
        jobId: details.jobId,
        retryInMs: details.retryInMs,
        elapsedMs: details.elapsedMs,
      };
      if (operation === "provider")
        log?.warn(fields, "Resolver provider degraded");
      else log?.error(fields, "Resolver persistence degraded");
    },
    recovered(operation: ResolverOperation, jobId: string) {
      if (!throttle.clear(operation)) return;
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
