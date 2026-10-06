// Reconciliation / robustness behavior of the rendered App.
//
// Every response and timer is injected: the tests drive `globalThis.fetch`
// with deterministic `Response` objects and, where the polling cadence matters,
// advance Vitest fake timers explicitly. `waitFor`/`findBy*` are avoided under
// fake timers because they deadlock; state is flushed with `act`.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { copy } from "@/components/game/copy";
import type {
  ActiveGuess,
  LatestGuess,
  PlayerState,
  PriceObservation,
  Pricing,
} from "@/game/types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
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

function observation(price: string): PriceObservation {
  return {
    price,
    providerTradeAt: "2026-10-06T12:00:00.000Z",
    receivedAt: 0,
  };
}

function freshPricing(price: string): Pricing {
  return { status: "fresh", observation: observation(price) };
}

function activeGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  return {
    id: "guess-active",
    direction: "up",
    startingPrice: "64000.00",
    acceptedAt: 0,
    eligibleAt: 0,
    ...overrides,
  };
}

function latestGuess(overrides: Partial<LatestGuess> = {}): LatestGuess {
  return {
    id: "guess-latest",
    direction: "up",
    startingPrice: "64000.00",
    acceptedAt: 0,
    eligibleAt: 0,
    result: "correct",
    scoreDelta: 1,
    resolvedAt: 0,
    observedPrice: "65000.00",
    observedAt: 0,
    ...overrides,
  };
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1",
    displayName: "Ada",
    score: 0,
    activeGuess: null,
    latestGuess: null,
    pricing: freshPricing("64000.00"),
    ...overrides,
  };
}

/**
 * Flushes pending microtasks (and any zero-delay timers) inside `act`. Works
 * with either fake or real timers so the same helper can be reused.
 */
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

function countPlayerGets(): number {
  return fetchMock.mock.calls.filter(
    (call) => String(call[0]) === "/api/player",
  ).length;
}

describe("App reconciliation and robustness", () => {
  it("keeps submissions blocked after an uncertain submit whose reconcile fails, then unblocks on an authoritative poll", async () => {
    useFakeClock();

    const known = player({ score: 5 });
    const pending = player({ score: 5, activeGuess: activeGuess() });
    const getQueue: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse(known)),
      () => Promise.reject(new TypeError("network down")),
      () => Promise.resolve(jsonResponse(pending)),
    ];
    let postCalls = 0;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        const next = getQueue.shift();
        return next
          ? next()
          : Promise.reject(new TypeError("unexpected extra GET"));
      }
      if (url === "/api/guesses" && method === "POST") {
        postCalls += 1;
        return Promise.reject(new TypeError("network down"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await settle();

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await settle();

    // The POST failed and the reconcile GET failed too: a retryable notice is
    // shown, but the known identity/score is preserved.
    expect(postCalls).toBe(1);
    expect(screen.getByText(/Network problem/)).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();

    // Submissions stay blocked: clicking Up must not issue another POST.
    const up = screen.getByRole("button", { name: "Up" });
    expect(up).toBeDisabled();
    fireEvent.click(up);
    await settle();
    expect(postCalls).toBe(1);

    // A later poll returns the authoritative pending player and unblocks the UI.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await settle();

    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();
    expect(screen.queryByText(/Network problem/)).not.toBeInTheDocument();
  });

  it("ignores a stale poll response that resolves after a newer mutation", async () => {
    useFakeClock();

    let resolveStale!: (response: Response) => void;
    const stalePromise = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });

    const initial = player({ score: 1 });
    const stalePlayer = player({
      score: 99,
      activeGuess: activeGuess({ id: "guess-stale" }),
      pricing: freshPricing("60000.00"),
    });
    const newerPlayer = player({
      score: 2,
      latestGuess: latestGuess(),
      pricing: freshPricing("70000.00"),
    });

    const getQueue: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse(initial)),
      () => stalePromise,
    ];

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        const next = getQueue.shift();
        return next
          ? next()
          : Promise.reject(new TypeError("unexpected extra GET"));
      }
      if (url === "/api/guesses" && method === "POST") {
        return Promise.resolve(jsonResponse(newerPlayer, 201));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await settle();
    expect(screen.getByText(/Score: 1/)).toBeInTheDocument();

    // Fire the idle poll; it hangs on the deferred (stale) response.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(countPlayerGets()).toBe(2);

    // A newer mutation resolves first and becomes the applied sequence.
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await settle();
    expect(screen.getByText(/Score: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Correct/)).toBeInTheDocument();

    // Now the older poll resolves; it must not overwrite the newer state.
    resolveStale(jsonResponse(stalePlayer));
    await settle();

    expect(screen.getByText(/Score: 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Score: 99/)).not.toBeInTheDocument();
    expect(screen.queryByText(/You guessed up from/)).not.toBeInTheDocument();
    // The live price is the newer player's observation, not the stale poll's.
    expect(
      within(
        screen.getByRole("region", { name: copy.price.labelLive }),
      ).getByText("$70,000.00"),
    ).toBeInTheDocument();
  });

  it("does not update state or reject after unmount with a request in flight", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    let rejectSubmit!: (error: unknown) => void;
    const submitPromise = new Promise<Response>((_resolve, reject) => {
      rejectSubmit = reject;
    });

    const ready = player({ score: 3 });
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        return Promise.resolve(jsonResponse(ready));
      }
      if (url === "/api/guesses" && method === "POST") {
        return submitPromise;
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    const { unmount } = render(<App />);
    await settle();
    expect(screen.getByText(/Score: 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await settle();

    unmount();
    rejectSubmit(new TypeError("network down"));
    await settle();

    expect(unhandled).toEqual([]);
    const unmountedWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0]).toLowerCase().includes("unmounted"),
    );
    expect(unmountedWarnings).toEqual([]);

    window.removeEventListener("unhandledrejection", onUnhandled);
    errorSpy.mockRestore();
  });

  it("preserves known state when a background poll fails", async () => {
    useFakeClock();

    const ready = player({
      score: 5,
      activeGuess: activeGuess(),
      pricing: freshPricing("65000.00"),
    });
    const getQueue: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse(ready)),
      () => Promise.reject(new TypeError("network down")),
    ];

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        const next = getQueue.shift();
        return next
          ? next()
          : Promise.reject(new TypeError("unexpected extra GET"));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await settle();

    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();
    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();
    expect(
      screen.getByText(/You guessed up from \$64,000\.00/),
    ).toBeInTheDocument();
    // The live price stays visible while a guess is pending.
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    // The failure is non-blocking: score, pending guess and price stay put and
    // the full-screen session error never replaces the game.
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();
    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();
    expect(
      screen.getByText(/You guessed up from \$64,000\.00/),
    ).toBeInTheDocument();
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "We couldn't load your game" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Will Bitcoin go up or down?" }),
    ).toBeInTheDocument();
  });

  it("ready-state session recovery failure shows a non-blocking notice and retry recovers", async () => {
    const ready = player({ score: 5, pricing: freshPricing("65000.00") });
    const getQueue: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse(ready)),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(jsonResponse(ready)),
    ];

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        const next = getQueue.shift();
        return next
          ? next()
          : Promise.reject(new TypeError("unexpected extra GET"));
      }
      if (url === "/api/guesses" && method === "POST") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      return Promise.reject(new TypeError(`unexpected ${method} ${url}`));
    });

    render(<App />);
    await screen.findByText(/Score: 5/);
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();

    // An unauthorized submit makes the hook re-run its session check; that
    // recovery GET fails, leaving a known player with a session error.
    fireEvent.click(screen.getByRole("button", { name: "Up" }));

    const noticeText = await screen.findByText(
      /We couldn't reach the game server/,
    );
    expect(noticeText.closest('[role="status"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "We couldn't load your game" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();

    // Retry resolves with a healthy player: the notice clears and play remains.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(
        screen.queryByText(/We couldn't reach the game server/),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Will Bitcoin go up or down?" }),
    ).toBeInTheDocument();
  });
});
