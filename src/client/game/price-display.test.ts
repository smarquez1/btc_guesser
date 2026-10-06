import { describe, expect, it } from "vitest";
import { compareExactDecimals, derivePriceDisplay } from "@/game/price-display";
import type {
  ActiveGuess,
  LatestGuess,
  PlayerState,
  PriceObservation,
} from "@/game/types";

function observation(price: string): PriceObservation {
  return {
    price,
    providerTradeAt: "2026-10-06T12:00:00.000Z",
    receivedAt: 1,
  };
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
    pricing: { status: "fresh", observation: observation("100.00") },
    ...overrides,
  };
}

describe("compareExactDecimals", () => {
  it("reports equal values as 0", () => {
    expect(compareExactDecimals("100.00", "100.00")).toBe(0);
  });

  it("reports a greater left value as 1", () => {
    expect(compareExactDecimals("100.01", "100.00")).toBe(1);
  });

  it("reports a lower left value as -1", () => {
    expect(compareExactDecimals("99.99", "100.00")).toBe(-1);
  });

  it("treats differing precision with the same value as equal", () => {
    expect(compareExactDecimals("100.1", "100.10")).toBe(0);
  });

  it("detects a tiny difference without rounding", () => {
    expect(compareExactDecimals("100.00001", "100")).toBe(1);
  });

  it("treats leading zeros as the same value", () => {
    expect(compareExactDecimals("0100", "100")).toBe(0);
  });

  it("returns neutral for invalid or empty input and never throws", () => {
    expect(compareExactDecimals("", "100")).toBe(0);
    expect(compareExactDecimals("100", "")).toBe(0);
    expect(compareExactDecimals("abc", "100")).toBe(0);
    expect(compareExactDecimals("1.2.3", "100")).toBe(0);
    expect(compareExactDecimals("-5", "100")).toBe(0);
    expect(compareExactDecimals("0", "0.00")).toBe(0);
    expect(() => compareExactDecimals("nope", "also-nope")).not.toThrow();
  });
});

describe("derivePriceDisplay", () => {
  it("shows the live observation price with no movement while idle", () => {
    expect(derivePriceDisplay(player())).toEqual({
      price: "100.00",
      movement: null,
    });
  });

  it("reports a null price when the observation is unavailable", () => {
    expect(
      derivePriceDisplay(
        player({ pricing: { status: "unavailable", observation: null } }),
      ),
    ).toEqual({ price: null, movement: null });
  });

  it("tints up from the last resolved move and keeps the live price", () => {
    expect(
      derivePriceDisplay(
        player({
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "110.00",
          }),
          pricing: { status: "fresh", observation: observation("130.00") },
        }),
      ),
    ).toEqual({ price: "130.00", movement: "up" });
  });

  it("tints down from the last resolved move and keeps the live price", () => {
    expect(
      derivePriceDisplay(
        player({
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "90.00",
          }),
          pricing: { status: "fresh", observation: observation("130.00") },
        }),
      ),
    ).toEqual({ price: "130.00", movement: "down" });
  });

  it("stays neutral when the resolved move was unchanged", () => {
    expect(
      derivePriceDisplay(
        player({
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "100.00",
          }),
        }),
      ),
    ).toEqual({ price: "100.00", movement: null });
  });

  it("clears the movement while a guess is active even with a latest guess", () => {
    expect(
      derivePriceDisplay(
        player({
          activeGuess: activeGuess({ startingPrice: "120.00" }),
          latestGuess: latestGuess({
            startingPrice: "100.00",
            observedPrice: "110.00",
          }),
        }),
      ),
    ).toEqual({ price: "100.00", movement: null });
  });

  it("stays neutral while a guess is active with no latest guess", () => {
    expect(
      derivePriceDisplay(
        player({
          activeGuess: activeGuess({ startingPrice: "120.00" }),
          pricing: { status: "fresh", observation: observation("130.00") },
        }),
      ),
    ).toEqual({ price: "130.00", movement: null });
  });
});
