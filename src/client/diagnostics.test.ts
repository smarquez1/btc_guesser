import { describe, expect, it, vi } from "vitest";
import {
  createDiagnostics,
  type DiagnosticEvent,
  reportableError,
} from "./diagnostics";

type Sink = (
  message: string,
  fields: Record<string, string | number | null>,
) => void;

function capture() {
  const calls: Array<{
    message: string;
    fields: Record<string, string | number | null>;
  }> = [];
  const sink: Sink = (message, fields) => {
    calls.push({ message, fields });
  };
  return { calls, sink };
}

describe("diagnostics", () => {
  it("emits only the allowlisted field set", () => {
    const { calls, sink } = capture();
    const diagnostics = createDiagnostics({ enabled: true, sink });

    diagnostics.report({
      category: "network",
      operation: "submit-guess",
      requestId: "req-1",
      status: null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fields).toEqual({
      category: "network",
      operation: "submit-guess",
      requestId: "req-1",
      status: null,
    });
    expect(Object.keys(calls[0]?.fields ?? {}).sort()).toEqual([
      "category",
      "operation",
      "requestId",
      "status",
    ]);
    expect(calls[0]?.message).toContain("network");
    expect(calls[0]?.message).toContain("submit-guess");
  });

  it("rate-limits identical operation/category pairs within the window", () => {
    const { calls, sink } = capture();
    let now = 1_000;
    const diagnostics = createDiagnostics({
      enabled: true,
      now: () => now,
      windowMs: 60_000,
      sink,
    });
    const event: DiagnosticEvent = {
      category: "provider",
      operation: "refresh",
      requestId: null,
      status: 503,
    };

    diagnostics.report(event);
    diagnostics.report(event);
    diagnostics.report(event);
    expect(calls).toHaveLength(1);

    now += 59_999;
    diagnostics.report(event);
    expect(calls).toHaveLength(1);

    now += 2;
    diagnostics.report(event);
    expect(calls).toHaveLength(2);

    // A different category is bounded independently.
    diagnostics.report({ ...event, category: "storage" });
    expect(calls).toHaveLength(3);
  });

  it("reset clears rate-limit state so the next report emits", () => {
    const { calls, sink } = capture();
    const diagnostics = createDiagnostics({ enabled: true, sink });
    const event: DiagnosticEvent = {
      category: "conflict",
      operation: "submit-guess",
      requestId: null,
    };

    diagnostics.report(event);
    diagnostics.report(event);
    expect(calls).toHaveLength(1);

    diagnostics.reset();
    diagnostics.report(event);
    expect(calls).toHaveLength(2);
  });

  it("never forwards secret or name data smuggled onto an event", () => {
    const { calls, sink } = capture();
    const diagnostics = createDiagnostics({ enabled: true, sink });
    const secretName = "SEEDED_PRIVATE_NAME";
    const secretToken = "SEEDED_TOKEN_9f8e7d";
    const smuggled = {
      category: "validation",
      operation: "create-player",
      requestId: "req-9",
      status: 400,
      displayName: secretName,
      cookie: secretToken,
      body: { displayName: secretName },
    } as unknown as DiagnosticEvent;

    diagnostics.report(smuggled);

    const rendered =
      calls.map((call) => call.message).join("\n") +
      JSON.stringify(calls.map((call) => call.fields));
    expect(rendered).not.toContain(secretName);
    expect(rendered).not.toContain(secretToken);
    expect(calls[0]?.fields).toEqual({
      category: "validation",
      operation: "create-player",
      requestId: "req-9",
      status: 400,
    });
  });

  it("normalizes a missing requestId to null and omits an absent status", () => {
    const { calls, sink } = capture();
    const diagnostics = createDiagnostics({ enabled: true, sink });
    const withoutRequestId = {
      category: "session",
      operation: "session",
    } as unknown as DiagnosticEvent;

    diagnostics.report(withoutRequestId);

    expect(calls[0]?.fields).toEqual({
      category: "session",
      operation: "session",
      requestId: null,
    });
    expect(Object.hasOwn(calls[0]?.fields ?? {}, "status")).toBe(false);
  });

  it("emits nothing when disabled", () => {
    const { calls, sink } = capture();
    const diagnostics = createDiagnostics({ enabled: false, sink });

    diagnostics.report({
      category: "unknown",
      operation: "refresh",
      requestId: null,
      status: 500,
    });

    expect(calls).toHaveLength(0);
  });

  it("maps a classified ApiError to a diagnostic event", () => {
    const event = reportableError(
      {
        code: "persistence_unavailable",
        status: 503,
        category: "storage",
        requestId: "req-42",
        retryable: true,
      },
      "refresh",
    );

    expect(event).toEqual({
      category: "storage",
      operation: "refresh",
      requestId: "req-42",
      status: 503,
    });
  });

  it("does not emit to console when enabled without a sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = createDiagnostics({ enabled: true });

    diagnostics.report({
      category: "network",
      operation: "session",
      requestId: null,
    });

    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});
