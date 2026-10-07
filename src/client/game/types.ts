// Shared client contracts for the BTC Guesser interface.
//
// Response shapes mirror the documented backend player API (README "Player API
// contract"). This module is the frozen seam between the fetch layer (`@/api`)
// and the presentational UI: it holds types and two purely presentational helpers
// and no game rules. The backend is the source of truth.

export type Direction = "up" | "down";
export type GuessResult = "correct" | "incorrect";
export type PriceStatus = "fresh" | "stale" | "unavailable";

export interface PriceObservation {
  price: string;
  providerTradeAt: string;
  receivedAt: number;
}

export interface Pricing {
  status: PriceStatus;
  observation: PriceObservation | null;
}

/** A guess that the server has accepted and not yet resolved. */
export interface ActiveGuess {
  id: string;
  direction: Direction;
  startingPrice: string;
  acceptedAt: number;
  eligibleAt: number;
}

/** The most recently resolved guess, including the server-owned outcome. */
export interface LatestGuess extends ActiveGuess {
  result: GuessResult;
  scoreDelta: 1 | -1;
  resolvedAt: number;
  observedPrice: string;
  observedAt: number;
}

export interface PlayerState {
  id: string;
  displayName: string;
  score: number;
  activeGuess: ActiveGuess | null;
  latestGuess: LatestGuess | null;
  pricing: Pricing;
}

/**
 * A failed request. `code` is the backend's error code when it returns one,
 * otherwise a coarse fallback; `requestId` is the backend correlation id when
 * present and never invented.
 */
export interface ApiError {
  code: string;
  status: number | null;
  requestId: string | null;
}

export type SessionStatus = "checking" | "onboarding" | "ready" | "error";

/**
 * Everything the presentational layer needs. Components must not fetch, read
 * cookies, compare prices, apply score changes, or decide outcomes.
 */
export interface GameController {
  sessionStatus: SessionStatus;
  player: PlayerState | null;
  /** Ticking clock (epoch ms) for local countdown display only. */
  now: number;
  creating: boolean;
  submitting: boolean;
  /** Optimistic direction while a submission is in flight, else null. */
  pendingDirection: Direction | null;
  /** Retryable failure while loading/restoring the session. */
  sessionError: ApiError | null;
  /** Last player-creation or guess-submission failure to surface. */
  actionError: ApiError | null;
  createPlayer: (displayName: string) => void;
  submitGuess: (direction: Direction) => void;
  retrySession: () => void;
  refresh: () => void;
  dismissActionError: () => void;
}

/** Remaining seconds before the server could resolve an active guess; never negative. */
export function remainingSeconds(eligibleAt: number, now: number): number {
  return Math.max(0, Math.ceil((eligibleAt - now) / 1000));
}
