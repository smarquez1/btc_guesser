import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { copy } from "@/components/game/copy";
import type {
  ActiveGuess,
  LatestGuess,
  PlayerState,
  PriceObservation,
} from "@/game/types";

const fetchMock = vi.fn<typeof fetch>();

/** Builds a `Response` (real when available, minimal otherwise) for a JSON body. */
function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const allHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...headers,
  };
  const ResponseCtor = (
    globalThis as {
      Response?: new (body?: BodyInit | null, init?: ResponseInit) => Response;
    }
  ).Response;
  if (typeof ResponseCtor === "function") {
    return new ResponseCtor(JSON.stringify(body), {
      status,
      headers: allHeaders,
    });
  }
  const headerMap = new Map(
    Object.entries(allHeaders).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  const minimal = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
  };
  return minimal as unknown as Response;
}

function makeObservation(
  overrides: Partial<PriceObservation> = {},
): PriceObservation {
  return {
    price: "64250.38",
    providerTradeAt: "2026-10-06T12:00:00.000Z",
    receivedAt: Date.now(),
    ...overrides,
  };
}

function makeActiveGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  const acceptedAt = Date.now();
  return {
    id: "guess-1",
    direction: "up",
    startingPrice: "64250.38",
    acceptedAt,
    eligibleAt: acceptedAt + 60_000,
    ...overrides,
  };
}

function makeLatestGuess(overrides: Partial<LatestGuess> = {}): LatestGuess {
  const acceptedAt = Date.now() - 120_000;
  return {
    id: "guess-1",
    direction: "up",
    startingPrice: "64250.38",
    acceptedAt,
    eligibleAt: acceptedAt + 60_000,
    result: "correct",
    scoreDelta: 1,
    resolvedAt: Date.now(),
    observedPrice: "64500.00",
    observedAt: Date.now(),
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1",
    displayName: "Ada",
    score: 0,
    activeGuess: null,
    latestGuess: null,
    pricing: { status: "fresh", observation: makeObservation() },
    ...overrides,
  };
}

/** Drains the microtask queue so already-resolved fetch mocks settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session lifecycle", () => {
  it("shows the loading state first, then the play view with score and price", async () => {
    let resolvePlayer!: (value: Response) => void;
    fetchMock.mockImplementation((input) => {
      if (String(input) === "/api/player") {
        return new Promise<Response>((resolve) => {
          resolvePlayer = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);

    expect(screen.getByText(copy.session.loading)).toBeInTheDocument();

    await act(async () => {
      resolvePlayer(jsonResponse(makePlayer({ score: 0 })));
    });

    expect(await screen.findByText(/Score: 0/)).toBeInTheDocument();
    expect(screen.getByText("$64,250.38")).toBeInTheDocument();
    expect(screen.queryByText(copy.session.loading)).not.toBeInTheDocument();
  });

  it("shows onboarding, not a session error, for a missing session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: copy.onboarding.heading,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: copy.session.errorHeading }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a network failure as a retryable state, never onboarding", async () => {
    fetchMock.mockResolvedValue(jsonResponse(makePlayer()));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePlayer({ score: 0 })));

    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: copy.session.errorHeading }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: copy.onboarding.heading }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy.session.retry }));

    expect(await screen.findByText(/Score: 0/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: copy.onboarding.heading }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a storage failure as a retryable state, never onboarding", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "persistence_unavailable" }, 503),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: copy.session.errorHeading }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: copy.onboarding.heading }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.session.retry }),
    ).toBeInTheDocument();
  });
});

describe("onboarding", () => {
  it("submits the raw name to the server, which owns validation", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      if (url === "/api/players") {
        return Promise.resolve(
          jsonResponse({ error: "invalid_display_name" }, 400),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: copy.onboarding.heading });

    await user.click(
      screen.getByRole("button", { name: copy.onboarding.submit }),
    );

    const postCall = fetchMock.mock.calls.find(
      ([request]) => String(request) === "/api/players",
    );
    expect(postCall?.[1]?.body).toBe(JSON.stringify({ displayName: "" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.onboarding.serverRejected,
    );
  });

  it("creates a player with the trimmed name and shows the server score", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      if (url === "/api/players") {
        return Promise.resolve(
          jsonResponse(makePlayer({ displayName: "Ada", score: 0 }), 201),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: copy.onboarding.heading });

    await user.type(screen.getByLabelText(copy.onboarding.label), "Ada");
    await user.click(
      screen.getByRole("button", { name: copy.onboarding.submit }),
    );

    const postCall = fetchMock.mock.calls.find(
      ([request]) => String(request) === "/api/players",
    );
    expect(postCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(postCall?.[1]?.body).toBe(JSON.stringify({ displayName: "Ada" }));

    expect(await screen.findByText(/Score: 0/)).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("creates only one player when submit is triggered twice while creating", async () => {
    let resolvePost!: (value: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      if (url === "/api/players") {
        return pendingPost;
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: copy.onboarding.heading });

    const input = screen.getByLabelText(copy.onboarding.label);
    const submit = screen.getByRole("button", {
      name: copy.onboarding.submit,
    });
    const form = submit.closest("form");
    expect(form).not.toBeNull();

    await user.type(input, "Ada");
    await user.click(submit);

    expect(
      screen.getByRole("button", { name: copy.onboarding.submitting }),
    ).toBeDisabled();

    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const postCalls = fetchMock.mock.calls.filter(
      ([request]) => String(request) === "/api/players",
    );
    expect(postCalls).toHaveLength(1);

    await act(async () => {
      resolvePost(jsonResponse(makePlayer(), 201));
    });
    expect(await screen.findByText(/Score: 0/)).toBeInTheDocument();
  });

  it("shows the server rejection inline and stays on onboarding", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
      }
      if (url === "/api/players") {
        return Promise.resolve(
          jsonResponse({ error: "invalid_display_name" }, 400),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: copy.onboarding.heading });

    await user.type(screen.getByLabelText(copy.onboarding.label), "Ada");
    await user.click(
      screen.getByRole("button", { name: copy.onboarding.submit }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.onboarding.serverRejected,
    );
    expect(
      screen.getByRole("heading", { name: copy.onboarding.heading }),
    ).toBeInTheDocument();
  });
});

describe("guess flow with fake timers", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits a guess and shows the pending state with both controls disabled", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse(makePlayer()));
      }
      if (url === "/api/guesses") {
        return Promise.resolve(
          jsonResponse(makePlayer({ activeGuess: makeActiveGuess() }), 201),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: copy.guess.up }));
    await flush();

    const guessCall = fetchMock.mock.calls.find(
      ([request]) => String(request) === "/api/guesses",
    );
    expect(guessCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(guessCall?.[1]?.body).toBe(JSON.stringify({ direction: "up" }));

    expect(
      screen.getByText(/You guessed up from \$64,250\.38/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Waiting — \d+s left/)).toBeInTheDocument();
    // The live price stays visible while a guess is pending.
    expect(screen.getByText("$64,250.38")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.guess.up })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: copy.guess.down }),
    ).toBeDisabled();
  });

  it("arms the active-guess poll cadence at acceptance, not after the idle interval", async () => {
    let gets = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/player" && method === "GET") {
        gets += 1;
        return Promise.resolve(
          jsonResponse(
            gets === 1
              ? makePlayer()
              : makePlayer({ activeGuess: makeActiveGuess() }),
          ),
        );
      }
      if (url === "/api/guesses") {
        return Promise.resolve(
          jsonResponse(makePlayer({ activeGuess: makeActiveGuess() }), 201),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();
    expect(gets).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: copy.guess.up }));
    await flush();
    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();

    // The onboarding idle timer must be gone: the active 5s cadence applies.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    await flush();
    expect(gets).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(gets).toBe(2);
  });

  it("sends only one guess when submit is triggered twice while pending", async () => {
    let resolveGuess!: (value: Response) => void;
    const pendingGuess = new Promise<Response>((resolve) => {
      resolveGuess = resolve;
    });
    let guessCalls = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        return Promise.resolve(jsonResponse(makePlayer()));
      }
      if (url === "/api/guesses") {
        guessCalls += 1;
        return pendingGuess;
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();

    const up = screen.getByRole("button", { name: copy.guess.up });
    fireEvent.click(up);
    await flush();
    fireEvent.click(up);
    await flush();
    expect(guessCalls).toBe(1);

    await act(async () => {
      resolveGuess(
        jsonResponse(makePlayer({ activeGuess: makeActiveGuess() }), 201),
      );
    });
    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();
  });

  it("disables both guess controls while an active guess exists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makePlayer({ activeGuess: makeActiveGuess() })),
    );

    render(<App />);
    await flush();

    // The live price remains visible during the wait.
    expect(screen.getByText("$64,250.38")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.guess.up })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: copy.guess.down }),
    ).toBeDisabled();
  });

  it("switches to the checking message at countdown expiry without resolving", async () => {
    const acceptedAt = Date.now();
    const activeGuess = makeActiveGuess({
      acceptedAt,
      eligibleAt: acceptedAt + 2000,
    });
    fetchMock.mockImplementation((input) => {
      if (String(input) === "/api/player") {
        return Promise.resolve(
          jsonResponse(makePlayer({ score: 5, activeGuess })),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();
    expect(screen.getByText(/Waiting —/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(screen.getByText(copy.pending.checking)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting —/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.guess.up })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: copy.guess.down }),
    ).toBeDisabled();
    expect(screen.getByText(/Score: 5/)).toBeInTheDocument();
    expect(screen.queryByText(copy.result.correct)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.incorrect)).not.toBeInTheDocument();
  });

  it("reconciles an active-guess conflict from the server response", async () => {
    let playerCalls = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        playerCalls += 1;
        return Promise.resolve(
          jsonResponse(
            playerCalls === 1
              ? makePlayer()
              : makePlayer({ activeGuess: makeActiveGuess() }),
          ),
        );
      }
      if (url === "/api/guesses") {
        return Promise.resolve(jsonResponse({ error: "active_guess" }, 409));
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: copy.guess.up }));
    await flush();

    expect(
      screen.getByText(/You guessed up from \$64,250\.38/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.guess.up })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: copy.guess.down }),
    ).toBeDisabled();
    expect(playerCalls).toBe(2);
  });

  it("keeps guessing blocked after an uncertain submit reconciles to an active guess", async () => {
    let playerCalls = 0;
    let guessCalls = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/player") {
        playerCalls += 1;
        return Promise.resolve(
          jsonResponse(
            playerCalls === 1
              ? makePlayer()
              : makePlayer({ activeGuess: makeActiveGuess() }),
          ),
        );
      }
      if (url === "/api/guesses") {
        guessCalls += 1;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(jsonResponse({ error: "unknown" }, 500));
    });

    render(<App />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: copy.guess.up }));
    await flush();

    expect(screen.getByText(/You guessed up from/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.guess.up })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: copy.guess.up }));
    await flush();
    expect(guessCalls).toBe(1);
  });

  it("polls on a bounded cadence without overlapping requests", async () => {
    let playerCalls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === "/api/player") {
        playerCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return jsonResponse(makePlayer({ activeGuess: makeActiveGuess() }));
      }
      return jsonResponse({ error: "unknown" }, 500);
    });

    render(<App />);
    await flush();
    expect(playerCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(playerCalls).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(playerCalls).toBe(3);
    expect(maxInFlight).toBe(1);
  });
});

describe("resolved results and price states", () => {
  it("renders the server-confirmed result and restored score", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makePlayer({
          score: 3,
          latestGuess: makeLatestGuess({ result: "correct", scoreDelta: 1 }),
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText(copy.result.correct)).toBeInTheDocument();
    expect(screen.getByText(copy.result.deltaPositive)).toBeInTheDocument();
    expect(screen.getByText(/Score: 3/)).toBeInTheDocument();
    // The live price stays visible between rounds.
    expect(screen.getByText("$64,250.38")).toBeInTheDocument();
  });

  it("renders the play view with no pending or result placeholders", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makePlayer({ activeGuess: null, latestGuess: null })),
    );

    render(<App />);

    expect(await screen.findByText("$64,250.38")).toBeInTheDocument();
    expect(screen.getByText(copy.guess.prompt)).toBeInTheDocument();
    expect(screen.queryByText(/You guessed/)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.correct)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.result.incorrect)).not.toBeInTheDocument();
  });

  it("hydrates a result that resolved while the page was away", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makePlayer({
          score: 7,
          activeGuess: null,
          latestGuess: makeLatestGuess({ result: "incorrect", scoreDelta: -1 }),
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText(copy.result.incorrect)).toBeInTheDocument();
    expect(screen.getByText(copy.result.deltaNegative)).toBeInTheDocument();
    expect(screen.getByText(/Score: 7/)).toBeInTheDocument();
    expect(screen.getByText("$64,250.38")).toBeInTheDocument();
    expect(screen.queryByText(/You guessed/)).not.toBeInTheDocument();
  });

  it("shows a fresh live price without a stale or unavailable disclosure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makePlayer({
          pricing: { status: "fresh", observation: makeObservation() },
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText("$64,250.38")).toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.price.staleHint)).not.toBeInTheDocument();
    expect(
      screen.queryByText(copy.price.unavailableHint),
    ).not.toBeInTheDocument();
  });

  it("marks a stale price as last known", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makePlayer({
          pricing: { status: "stale", observation: makeObservation() },
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText("$64,250.38")).toBeInTheDocument();
    expect(screen.getByText(/Stale — last known price/)).toBeInTheDocument();
  });

  it("never fabricates a price when the observation is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makePlayer({
          pricing: { status: "unavailable", observation: null },
        }),
      ),
    );

    render(<App />);

    expect(
      await screen.findByText(copy.price.unavailableValue),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.price.unavailableHint)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
