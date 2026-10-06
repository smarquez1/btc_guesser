import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { PricePanel } from "@/components/game/PricePanel";
import type {
  ActiveGuess,
  LatestGuess,
  PlayerState,
  PriceObservation,
  Pricing,
} from "@/game/types";

function observation(price: string): PriceObservation {
  return {
    price,
    providerTradeAt: "2026-10-06T12:00:00.000Z",
    receivedAt: 1,
  };
}

function fresh(price: string): Pricing {
  return { status: "fresh", observation: observation(price) };
}

function activeGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  return {
    id: "guess-active",
    direction: "up",
    startingPrice: "100.00",
    acceptedAt: 0,
    eligibleAt: 60_000,
    ...overrides,
  };
}

function latestGuess(overrides: Partial<LatestGuess> = {}): LatestGuess {
  return {
    ...activeGuess(),
    id: "guess-latest",
    result: "correct",
    scoreDelta: 1,
    resolvedAt: 0,
    observedPrice: "110.00",
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
    pricing: fresh("100.00"),
    ...overrides,
  };
}

describe("PricePanel price display", () => {
  it("shows the live price and label with no updated timer while idle", () => {
    render(<PricePanel player={player()} />);

    expect(screen.getByText("Latest BTC/USD price")).toBeInTheDocument();
    const price = screen.getByText("$100.00");
    expect(price.className).not.toContain("text-emerald-700");
    expect(price.className).not.toContain("text-destructive");
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("shows the stale hint with the live price", () => {
    render(
      <PricePanel
        player={player({
          pricing: { status: "stale", observation: observation("100.00") },
        })}
      />,
    );

    const price = screen.getByText("$100.00");
    expect(price.className).not.toContain("text-emerald-700");
    expect(price.className).not.toContain("text-destructive");
    expect(screen.getByText("Stale — last known price")).toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
  });

  it("shows the unavailable placeholder and no fabricated number", () => {
    render(
      <PricePanel
        player={player({
          pricing: { status: "unavailable", observation: null },
        })}
      />,
    );

    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("No price data is available right now."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("keeps showing the live price while a guess is active", () => {
    render(
      <PricePanel
        player={player({
          activeGuess: activeGuess({ startingPrice: "120.00" }),
          pricing: fresh("130.00"),
        })}
      />,
    );

    const price = screen.getByText("$130.00");
    expect(price.className).not.toContain("text-emerald-700");
    expect(price.className).not.toContain("text-destructive");
    expect(screen.queryByText("$120.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/Score/)).not.toBeInTheDocument();
    expect(screen.queryByText("Correct")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect")).not.toBeInTheDocument();
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("tints the live price green with an up cue after a higher resolved move", () => {
    render(
      <PricePanel
        player={player({
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "110.00",
          }),
          pricing: fresh("130.00"),
        })}
      />,
    );

    const price = screen.getByText("$130.00");
    expect(price.className).toContain("text-emerald-700");
    expect(price.className).not.toContain("text-destructive");
    expect(
      screen.getByRole("img", {
        name: "Price higher than your starting price",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.queryByText("$110.00")).not.toBeInTheDocument();
  });

  it("tints the live price red with a down cue after a lower resolved move", () => {
    render(
      <PricePanel
        player={player({
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "90.00",
          }),
          pricing: fresh("130.00"),
        })}
      />,
    );

    const price = screen.getByText("$130.00");
    expect(price.className).toContain("text-destructive");
    expect(price.className).not.toContain("text-emerald-700");
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Price lower than your starting price",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("$90.00")).not.toBeInTheDocument();
  });

  it("stays neutral while a guess is active even with a resolved move", () => {
    render(
      <PricePanel
        player={player({
          activeGuess: activeGuess({ startingPrice: "120.00" }),
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "110.00",
          }),
          pricing: fresh("130.00"),
        })}
      />,
    );

    const price = screen.getByText("$130.00");
    expect(price.className).not.toContain("text-emerald-700");
    expect(price.className).not.toContain("text-destructive");
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  it("opts out of the color transition under reduced motion", () => {
    render(<PricePanel player={player()} />);

    expect(screen.getByText("$100.00").className).toContain(
      "motion-reduce:transition-none",
    );
  });

  it("renders no score or result text", () => {
    render(<PricePanel player={player({ latestGuess: latestGuess() })} />);

    expect(screen.queryByText(/Score/)).not.toBeInTheDocument();
    expect(screen.queryByText("Correct")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect")).not.toBeInTheDocument();
  });
});

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

describe("App revealed price does not disturb score or result", () => {
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
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the live price colored while score and result stay unchanged", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        player({
          score: 3,
          latestGuess: latestGuess({
            result: "correct",
            startingPrice: "64000.00",
            observedPrice: "65000.00",
          }),
          pricing: fresh("65000.00"),
        }),
      ),
    );

    render(<App />);
    await settle();

    const price = screen.getByText("$65,000.00");
    expect(price.className).toContain("text-emerald-700");
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByText("Latest BTC/USD price")).toBeInTheDocument();
    expect(screen.getByText(/Score: 3/)).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.queryByText("Incorrect")).not.toBeInTheDocument();
  });
});
