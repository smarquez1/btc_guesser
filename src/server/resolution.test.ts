import { describe, expect, it } from "vitest";
import type { PendingGuess } from "./players.js";
import type { PriceObservation } from "./pricing.js";
import { resolveGuess } from "./resolution.js";

const eligibleAt = 61_000;
const guess: PendingGuess = {
  id: "guess-1",
  direction: "up",
  startingPrice: "64123.456",
  acceptedAt: 1_000,
  eligibleAt,
};
const observation = (
  price: string,
  receivedAt: number,
  providerTradeAt = new Date(receivedAt).toISOString(),
): PriceObservation => ({ price, providerTradeAt, receivedAt });

describe("resolveGuess", () => {
  it("keeps a differing price pending before the deadline", () => {
    expect(
      resolveGuess(
        guess,
        observation("64123.4561", eligibleAt - 1),
        eligibleAt - 1,
      ),
    ).toBeNull();
  });

  it("keeps a pre-deadline receipt pending even after the deadline", () => {
    expect(
      resolveGuess(
        guess,
        observation("64123.4561", eligibleAt - 1),
        eligibleAt + 300_000,
      ),
    ).toBeNull();
  });

  it("treats a receipt exactly at the deadline as eligible", () => {
    expect(
      resolveGuess(guess, observation("64123.4561", eligibleAt), eligibleAt),
    ).toEqual({
      result: "correct",
      scoreDelta: 1,
      resolvedAt: eligibleAt,
      observedPrice: "64123.4561",
      observedAt: eligibleAt,
    });
  });

  it("ignores the provider trade timestamp for eligibility", () => {
    const beforeDeadline = new Date(eligibleAt - 60_000).toISOString();
    expect(
      resolveGuess(
        guess,
        observation("64123.4561", eligibleAt, beforeDeadline),
        eligibleAt,
      ),
    ).toMatchObject({ result: "correct", scoreDelta: 1 });
  });

  it("keeps equal values pending across precision and leading zeros", () => {
    expect(
      resolveGuess(guess, observation("64123.456000", eligibleAt), eligibleAt),
    ).toBeNull();
    expect(
      resolveGuess(guess, observation("064123.456", eligibleAt), eligibleAt),
    ).toBeNull();
  });

  it("resolves a full-precision difference that rounds to the same display price", () => {
    expect(Number("64123.456").toFixed(2)).toBe(
      Number("64123.456000001").toFixed(2),
    );
    expect(
      resolveGuess(
        guess,
        observation("64123.456000001", eligibleAt),
        eligibleAt,
      ),
    ).toMatchObject({ result: "correct", scoreDelta: 1 });
  });

  it("resolves a differing observation whose receipt age is exactly 15 seconds", () => {
    const now = eligibleAt + 30_000;
    expect(
      resolveGuess(guess, observation("64123.4561", now - 15_000), now),
    ).toMatchObject({ result: "correct", scoreDelta: 1 });
  });

  it("keeps a differing observation with a 15,001ms receipt age pending", () => {
    const now = eligibleAt + 30_000;
    expect(
      resolveGuess(guess, observation("64123.4561", now - 15_001), now),
    ).toBeNull();
  });

  it("keeps a differing observation whose trade is older than 120 seconds pending", () => {
    const now = eligibleAt + 200_000;
    expect(
      resolveGuess(
        guess,
        observation("64123.4561", now, new Date(now - 120_001).toISOString()),
        now,
      ),
    ).toBeNull();
  });

  it("keeps a differing observation whose trade is more than 5 seconds in the future pending", () => {
    const now = eligibleAt;
    expect(
      resolveGuess(
        guess,
        observation("64123.4561", now, new Date(now + 5_001).toISOString()),
        now,
      ),
    ).toBeNull();
  });

  it("resolves a fresh post-deadline differing observation for both directions", () => {
    const now = eligibleAt + 1;
    expect(
      resolveGuess(guess, observation("64123.457", now), now),
    ).toMatchObject({ result: "correct", scoreDelta: 1 });
    expect(
      resolveGuess(guess, observation("64123.455", now), now),
    ).toMatchObject({ result: "incorrect", scoreDelta: -1 });
  });

  it("scores each direction and result honestly", () => {
    const cases = [
      {
        direction: "up" as const,
        price: "64123.457",
        result: "correct",
        delta: 1,
      },
      {
        direction: "up" as const,
        price: "64123.455",
        result: "incorrect",
        delta: -1,
      },
      {
        direction: "down" as const,
        price: "64123.455",
        result: "correct",
        delta: 1,
      },
      {
        direction: "down" as const,
        price: "64123.457",
        result: "incorrect",
        delta: -1,
      },
    ];
    for (const item of cases) {
      expect(
        resolveGuess(
          { ...guess, direction: item.direction },
          observation(item.price, eligibleAt),
          eligibleAt,
        ),
      ).toMatchObject({ result: item.result, scoreDelta: item.delta });
    }
  });
});
