import type { FastifyRequest } from "fastify";

type Operation =
  | "storage_read"
  | "storage_create"
  | "storage_accept"
  | "price"
  | "request";
type Category =
  | "persistence_failure"
  | "persistence_unconfigured"
  | "price_unavailable"
  | "price_failure"
  | "request_failure";

export function playerDiagnostics(now: () => number) {
  // Separate read/write slots prevent a good read from announcing write recovery.
  const degraded = new Map<Operation, number>();
  return {
    failed(request: FastifyRequest, operation: Operation, category: Category) {
      const time = now();
      const previous = degraded.get(operation);
      if (previous !== undefined && time - previous < 60_000) return;
      degraded.set(operation, time);
      const fields = {
        event: "player_operation_degraded",
        category,
        operation,
        requestId: request.id,
      };
      if (category === "persistence_failure" || category === "request_failure")
        request.log.error(
          fields,
          "Player operation failed; check dependency health/configuration",
        );
      else
        request.log.warn(
          fields,
          "Player operation unavailable; check configuration/provider health",
        );
    },
    recovered(request: FastifyRequest, operation: Operation) {
      if (!degraded.delete(operation)) return;
      request.log.info(
        {
          event: "player_operation_recovered",
          category: "recovery",
          operation,
          requestId: request.id,
        },
        "Player operation recovered",
      );
    },
  };
}
