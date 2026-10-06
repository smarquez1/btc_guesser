// Pure game state machine for the browser client.
//
// This module owns the reducer and the small derived predicates the hook uses.
// It has no React, DOM, or network dependencies so every transition is
// unit-testable in a plain Node environment. The hook (`useGame`) is the only
// place that performs I/O and schedules timers.

import type {
  ApiError,
  Direction,
  PlayerState,
  SessionStatus,
} from "@/game/types";

export interface GameState {
  sessionStatus: SessionStatus;
  player: PlayerState | null;
  creating: boolean;
  submitting: boolean;
  pendingDirection: Direction | null;
  sessionError: ApiError | null;
  actionError: ApiError | null;
}

export const initialGameState: GameState = {
  sessionStatus: "checking",
  player: null,
  creating: false,
  submitting: false,
  pendingDirection: null,
  sessionError: null,
  actionError: null,
};

export type GameAction =
  | { type: "session/start" }
  | { type: "session/missing" }
  | { type: "session/ready"; player: PlayerState }
  | { type: "session/failed"; error: ApiError }
  | { type: "player/creating" }
  | { type: "player/created"; player: PlayerState }
  | { type: "player/createFailed"; error: ApiError }
  | { type: "guess/submitting"; direction: Direction }
  | { type: "guess/result"; player: PlayerState }
  | { type: "guess/failed"; error: ApiError }
  // Reconcile failed after a lost/ambiguous response. The submission stays
  // blocked (`submitting` remains true) until a later refresh resolves it.
  | { type: "guess/reconciling"; error: ApiError }
  | { type: "action/dismiss" }
  | { type: "action/clear" };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "session/start":
      return { ...state, sessionStatus: "checking", sessionError: null };
    case "session/missing":
      // A confirmed missing session resets identity. Drop any stale in-flight
      // flags and action feedback from the previous (now unknown) identity.
      return {
        ...state,
        sessionStatus: "onboarding",
        player: null,
        creating: false,
        submitting: false,
        pendingDirection: null,
        sessionError: null,
        actionError: null,
      };
    case "session/ready":
      return {
        ...state,
        sessionStatus: "ready",
        player: action.player,
        creating: false,
        submitting: false,
        pendingDirection: null,
        sessionError: null,
        actionError: null,
      };
    case "session/failed":
      // A regression while a player is already known must not erase identity;
      // surface it as a non-blocking notice and stay in play.
      if (state.player !== null) {
        return { ...state, sessionStatus: "ready", sessionError: action.error };
      }
      return { ...state, sessionStatus: "error", sessionError: action.error };
    case "player/creating":
      return { ...state, creating: true, actionError: null };
    case "player/created":
      return {
        ...state,
        sessionStatus: "ready",
        player: action.player,
        creating: false,
        pendingDirection: null,
        actionError: null,
        sessionError: null,
      };
    case "player/createFailed":
      return { ...state, creating: false, actionError: action.error };
    case "guess/submitting":
      return {
        ...state,
        submitting: true,
        pendingDirection: action.direction,
        actionError: null,
      };
    case "guess/result":
      // Authoritative reconcile: replace local state with the server's player.
      return {
        ...state,
        submitting: false,
        pendingDirection: null,
        player: action.player,
        actionError: null,
      };
    case "guess/failed":
      return {
        ...state,
        submitting: false,
        pendingDirection: null,
        actionError: action.error,
      };
    case "guess/reconciling":
      // Keep `submitting` true so a lost outcome cannot be retried blindly.
      // The pressed direction is still the best guess at the intended outcome,
      // so keep it until a later refresh/reconcile resolves the truth.
      return { ...state, submitting: true, actionError: action.error };
    case "action/dismiss":
      return { ...state, actionError: null };
    case "action/clear":
      return { ...state, actionError: null };
  }
}

/**
 * A guess may start only from a ready session with a known player, no request
 * already in flight, and no active guess the server has not resolved yet.
 */
export function canSubmitGuess(state: GameState): boolean {
  return (
    state.sessionStatus === "ready" &&
    !state.submitting &&
    state.player !== null &&
    state.player.activeGuess === null
  );
}

/** Polling only makes sense once a session is ready and a player is known. */
export function shouldPoll(state: GameState): boolean {
  return state.sessionStatus === "ready";
}

/** Bounded polling cadence: tighter while a guess is pending, relaxed otherwise. */
export const ACTIVE_GUESS_POLL_MS = 5000;
export const IDLE_POLL_MS = 15000;

export function pollDelayMs(state: GameState): number {
  return state.player?.activeGuess != null
    ? ACTIVE_GUESS_POLL_MS
    : IDLE_POLL_MS;
}
