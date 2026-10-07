// Shared client contracts for the BTC Guesser interface.
//
// Response shapes mirror the documented backend player API (README "Player API
// contract"). This module is the frozen seam between the data/logic modules
// (`@/api`, `@/diagnostics`, `@/game/useGame`) and the presentational UI.

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

/** Diagnostic classes used to keep server failures distinct from network ones. */
export type DiagnosticCategory =
  | "validation"
  | "session"
  | "conflict"
  | "provider"
  | "storage"
  | "network"
  | "unknown";

export type ApiErrorCode =
  | "invalid_display_name"
  | "invalid_direction"
  | "invalid_body"
  | "unauthorized"
  | "active_guess"
  | "price_unavailable"
  | "persistence_unavailable"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid_request"
  | "network"
  | "unknown";

/**
 * A classified failure. `requestId` is the backend correlation id when the
 * response exposes one, otherwise `null` (never invented for a lost response).
 */
export interface ApiError {
  code: ApiErrorCode;
  status: number | null;
  category: DiagnosticCategory;
  requestId: string | null;
  retryable: boolean;
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

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Why a display name is invalid; the UI maps this code to user-facing copy. */
export type DisplayNameError = "empty" | "too_long";

/** Mirrors the server's display-name rule: trimmed, nonempty, <= 80 UTF-16 units. */
export function validateDisplayName(value: string): DisplayNameError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "empty";
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return "too_long";
  }
  return null;
}

/** Remaining seconds before the server could resolve an active guess; never negative. */
export function remainingSeconds(eligibleAt: number, now: number): number {
  return Math.max(0, Math.ceil((eligibleAt - now) / 1000));
}
