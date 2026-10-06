// Diagnostic privacy, category mapping, rate limiting and operation labels.
//
// Some assertions exercise `createDiagnostics`/`reportableError` directly (with
// an injected clock and sink); others render the real App and spy on the
// console sink to prove the same guarantees end-to-end.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { ApiRequestError, getPlayer, toApiError } from "@/api";
import {
  createDiagnostics,
  type DiagnosticEvent,
  reportableError,
} from "@/diagnostics";
import type { ApiError, DiagnosticCategory, PlayerState } from "@/game/types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1",
    displayName: "Ada",
    score: 0,
    activeGuess: null,
    latestGuess: null,
    pricing: {
      status: "fresh",
      observation: {
        price: "64000.00",
        providerTradeAt: "2026-10-06T12:00:00.000Z",
        receivedAt: 0,
      },
    },
    ...overrides,
  };
}

function apiError(code: ApiError["code"], status: number | null): ApiError {
  return toApiError(new ApiRequestError(code, status, null));
}

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await Promise.resolve();
      }
    });
  }
}

function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

interface ConsoleSpies {
  spies: Array<ReturnType<typeof vi.spyOn>>;
  diagnosticOperations: () => string[];
  diagnosticCategories: () => string[];
  serialized: () => string;
}

/** Spies on every console method and silences them for the duration. */
function spyConsole(): ConsoleSpies {
  const methods = ["info", "log", "warn", "error", "debug"] as const;
  const spies = methods.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );

  const calls = (): unknown[][] => spies.flatMap((spy) => spy.mock.calls);

  const diagnosticCalls = (): unknown[][] =>
    calls().filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("BTC Guesser diagnostic"),
    );

  const field = (call: unknown[], key: string): string => {
    const fields = call[1];
    if (typeof fields !== "object" || fields === null) return "";
    const value = (fields as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  };

  return {
    spies,
    diagnosticOperations: () =>
      diagnosticCalls().map((call) => field(call, "operation")),
    diagnosticCategories: () =>
      diagnosticCalls().map((call) => field(call, "category")),
    serialized: () =>
      calls()
        .map((call) =>
          call
            .map((arg) => {
              if (typeof arg === "string") return arg;
              try {
                return JSON.stringify(arg) ?? String(arg);
              } catch {
                return String(arg);
              }
            })
            .join(" "),
        )
        .join("\n"),
  };
}

describe("diagnostic privacy and classification", () => {
  it("never logs seeded names/credentials from an error body and never reads document.cookie", async () => {
    const seededName = "Ada Secret";
    const seededSecret = "super-secret-token-123";
    const consoleSpies = spyConsole();

    let cookieReads = 0;
    vi.spyOn(Document.prototype, "cookie", "get").mockImplementation(() => {
      cookieReads += 1;
      return "";
    });

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        return Promise.resolve(
          jsonResponse(
            {
              error: "persistence_unavailable",
              displayName: seededName,
              token: seededSecret,
              body: { displayName: seededName, credential: seededSecret },
            },
            503,
            { "x-request-id": "req-seeded" },
          ),
        );
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await screen.findByRole("heading", {
      name: "We couldn't load your game",
    });

    const rendered = consoleSpies.serialized();
    expect(rendered).not.toContain(seededName);
    expect(rendered).not.toContain(seededSecret);
    expect(cookieReads).toBe(0);
  });

  it("carries an available request id and never invents an absent one", async () => {
    const withId: ApiError = {
      code: "active_guess",
      status: 409,
      category: "conflict",
      requestId: "req-abc",
      retryable: false,
    };
    const withoutId: ApiError = { ...withId, requestId: null };

    expect(reportableError(withId, "submit-guess")).toEqual({
      category: "conflict",
      operation: "submit-guess",
      requestId: "req-abc",
      status: 409,
    });
    expect(reportableError(withoutId, "submit-guess").requestId).toBeNull();

    // The header path: a response header flows into the reportable event…
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "active_guess" }, 409, {
        "x-request-id": "req-header",
      }),
    );
    const fromHeader = toApiError(
      await getPlayer().catch((thrown: unknown) => thrown),
    );
    expect(reportableError(fromHeader, "refresh").requestId).toBe("req-header");

    // …and an absent header yields null rather than a fabricated id.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "active_guess" }, 409),
    );
    const noHeader = toApiError(
      await getPlayer().catch((thrown: unknown) => thrown),
    );
    expect(reportableError(noHeader, "refresh").requestId).toBeNull();

    // The reporter forwards the id through its allowlisted field.
    const sink = vi.fn();
    const diagnostics = createDiagnostics({ enabled: true, sink });
    diagnostics.report(reportableError(withId, "refresh"));
    expect(sink.mock.calls[0]?.[1]).toMatchObject({ requestId: "req-abc" });
  });

  it("maps each failure kind to its diagnostic category", () => {
    const cases: Array<[ApiError, DiagnosticCategory]> = [
      [apiError("active_guess", 409), "conflict"],
      [apiError("price_unavailable", 503), "provider"],
      [apiError("persistence_unavailable", 503), "storage"],
      [apiError("unauthorized", 401), "session"],
      [apiError("network", null), "network"],
      [apiError("invalid_display_name", null), "validation"],
    ];

    for (const [error, category] of cases) {
      expect(error.category).toBe(category);
      expect(reportableError(error, "refresh").category).toBe(category);
    }
  });

  it("classifies a rejected transport call as a network failure", async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    const transport = toApiError(
      await getPlayer().catch((thrown: unknown) => thrown),
    );
    expect(transport.code).toBe("network");
    expect(transport.category).toBe("network");
    expect(reportableError(transport, "refresh").category).toBe("network");
  });

  it("bounds repeated identical reports to one emit per window", () => {
    const sink = vi.fn();
    let now = 1_000;
    const diagnostics = createDiagnostics({
      enabled: true,
      now: () => now,
      windowMs: 60_000,
      sink,
    });
    const event: DiagnosticEvent = {
      category: "network",
      operation: "refresh",
      requestId: null,
    };

    for (let index = 0; index < 50; index += 1) {
      diagnostics.report(event);
    }
    expect(sink).toHaveBeenCalledTimes(1);

    now += 59_999;
    diagnostics.report(event);
    expect(sink).toHaveBeenCalledTimes(1);

    now += 2;
    diagnostics.report(event);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated poll failures through the rendered App", async () => {
    useFakeClock();
    const consoleSpies = spyConsole();

    const ready = player({
      activeGuess: {
        id: "guess-active",
        direction: "up",
        startingPrice: "64000.00",
        acceptedAt: 0,
        eligibleAt: 0,
      },
    });
    let firstGet = true;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        if (firstGet) {
          firstGet = false;
          return Promise.resolve(jsonResponse(ready));
        }
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await settle();

    // Five failing polls inside the 60s window emit only once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    await settle();

    const refreshEmits = consoleSpies
      .diagnosticOperations()
      .filter((operation) => operation === "refresh");
    expect(refreshEmits).toHaveLength(1);
    expect(consoleSpies.diagnosticCategories()).toContain("network");
  });
});

describe("diagnostic operation labels", () => {
  it("labels a session-load failure as session", async () => {
    const consoleSpies = spyConsole();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await screen.findByRole("heading", {
      name: "We couldn't load your game",
    });

    expect(consoleSpies.diagnosticOperations()).toContain("session");
  });

  it("labels a create-player failure as create-player", async () => {
    const consoleSpies = spyConsole();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      if (url === "/api/players" && method === "POST") {
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    const input = await screen.findByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Start playing" }));
    await screen.findByText(/Network problem/);

    expect(consoleSpies.diagnosticOperations()).toContain("create-player");
  });

  it("labels a submit failure as submit-guess", async () => {
    const consoleSpies = spyConsole();
    let firstGet = true;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        if (firstGet) {
          firstGet = false;
          return Promise.resolve(jsonResponse(player()));
        }
        return Promise.resolve(
          jsonResponse(
            player({
              activeGuess: {
                id: "guess-active",
                direction: "up",
                startingPrice: "64000.00",
                acceptedAt: 0,
                eligibleAt: 0,
              },
            }),
          ),
        );
      }
      if (url === "/api/guesses" && method === "POST") {
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await screen.findByText(/Score: 0/);
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await screen.findByText(/You guessed up from/);

    expect(consoleSpies.diagnosticOperations()).toContain("submit-guess");
  });

  it("labels a poll failure as refresh", async () => {
    useFakeClock();
    const consoleSpies = spyConsole();
    let firstGet = true;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        if (firstGet) {
          firstGet = false;
          return Promise.resolve(
            jsonResponse(
              player({
                activeGuess: {
                  id: "guess-active",
                  direction: "up",
                  startingPrice: "64000.00",
                  acceptedAt: 0,
                  eligibleAt: 0,
                },
              }),
            ),
          );
        }
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await settle();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(consoleSpies.diagnosticOperations()).toContain("refresh");
  });
});
