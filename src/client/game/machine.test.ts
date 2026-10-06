import { describe, expect, it } from "vitest";
import type { ActiveGuess, ApiError, PlayerState } from "@/game/types";
import {
  ACTIVE_GUESS_POLL_MS,
  canSubmitGuess,
  type GameState,
  gameReducer,
  IDLE_POLL_MS,
  initialGameState,
  pollDelayMs,
  shouldPoll,
} from "./machine";

const networkError: ApiError = {
  code: "network",
  status: null,
  category: "network",
  requestId: null,
  retryable: true,
};

const sessionError: ApiError = {
  code: "unauthorized",
  status: 401,
  category: "session",
  requestId: "req-1",
  retryable: false,
};

const activeGuess: ActiveGuess = {
  id: "guess-1",
  direction: "up",
  startingPrice: "100.5",
  acceptedAt: 1_000,
  eligibleAt: 61_000,
};

const player: PlayerState = {
  id: "player-1",
  displayName: "Ada",
  score: 3,
  activeGuess: null,
  latestGuess: null,
  pricing: { status: "fresh", observation: null },
};

const playingState: GameState = {
  sessionStatus: "ready",
  player,
  creating: false,
  submitting: false,
  pendingDirection: null,
  sessionError: null,
  actionError: null,
};

function stateWith(overrides: Partial<GameState>): GameState {
  return { ...playingState, ...overrides };
}

describe("gameReducer", () => {
  it("starts in a checking state with no player", () => {
    expect(initialGameState).toEqual({
      sessionStatus: "checking",
      player: null,
      creating: false,
      submitting: false,
      pendingDirection: null,
      sessionError: null,
      actionError: null,
    });
  });

  it("session/start returns to checking and clears the session error only", () => {
    const before = stateWith({
      sessionStatus: "error",
      sessionError: networkError,
      actionError: networkError,
    });
    const after = gameReducer(before, { type: "session/start" });
    expect(after).toEqual({
      ...before,
      sessionStatus: "checking",
      sessionError: null,
    });
  });

  it("session/missing enters onboarding and clears identity and feedback", () => {
    const before = stateWith({
      sessionStatus: "ready",
      creating: true,
      actionError: networkError,
    });
    const after = gameReducer(before, { type: "session/missing" });
    expect(after).toEqual({
      sessionStatus: "onboarding",
      player: null,
      creating: false,
      submitting: false,
      pendingDirection: null,
      sessionError: null,
      actionError: null,
    });
  });

  it("session/ready enters play with the server player", () => {
    const after = gameReducer(initialGameState, {
      type: "session/ready",
      player,
    });
    expect(after).toEqual({
      sessionStatus: "ready",
      player,
      creating: false,
      submitting: false,
      pendingDirection: null,
      sessionError: null,
      actionError: null,
    });
  });

  it("session failure with no known player shows the error screen", () => {
    const after = gameReducer(initialGameState, {
      type: "session/failed",
      error: networkError,
    });
    expect(after.sessionStatus).toBe("error");
    expect(after.player).toBeNull();
    expect(after.sessionError).toEqual(networkError);
  });

  it("session failure with a known player stays ready and preserves identity", () => {
    const before = stateWith({ sessionStatus: "checking", player });
    const after = gameReducer(before, {
      type: "session/failed",
      error: networkError,
    });
    expect(after.sessionStatus).toBe("ready");
    expect(after.player).toBe(player);
    expect(after.player?.score).toBe(3);
    expect(after.sessionError).toEqual(networkError);
  });

  it("player/creating flags the pending creation and clears the action error", () => {
    const after = gameReducer(stateWith({ actionError: networkError }), {
      type: "player/creating",
    });
    expect(after.creating).toBe(true);
    expect(after.actionError).toBeNull();
  });

  it("player/created enters play with the new player", () => {
    const before = stateWith({ sessionStatus: "onboarding", player: null });
    const after = gameReducer(before, { type: "player/created", player });
    expect(after).toEqual({
      sessionStatus: "ready",
      player,
      creating: false,
      submitting: false,
      pendingDirection: null,
      sessionError: null,
      actionError: null,
    });
  });

  it("player/createFailed clears pending and surfaces the error while onboarding", () => {
    const before = stateWith({
      sessionStatus: "onboarding",
      player: null,
      creating: true,
    });
    const after = gameReducer(before, {
      type: "player/createFailed",
      error: networkError,
    });
    expect(after.sessionStatus).toBe("onboarding");
    expect(after.player).toBeNull();
    expect(after.creating).toBe(false);
    expect(after.actionError).toEqual(networkError);
  });

  it("guess/submitting flags the in-flight submission", () => {
    const after = gameReducer(stateWith({ actionError: networkError }), {
      type: "guess/submitting",
      direction: "up",
    });
    expect(after.submitting).toBe(true);
    expect(after.actionError).toBeNull();
  });

  it("guess/result reconciles with the authoritative player", () => {
    const resolved: PlayerState = { ...player, score: 4, activeGuess };
    const after = gameReducer(
      stateWith({ submitting: true, actionError: networkError }),
      { type: "guess/result", player: resolved },
    );
    expect(after.submitting).toBe(false);
    expect(after.player).toEqual(resolved);
    expect(after.actionError).toBeNull();
  });

  it("guess/failed stops pending without touching the player or score", () => {
    const before = stateWith({ submitting: true, player });
    const after = gameReducer(before, {
      type: "guess/failed",
      error: networkError,
    });
    expect(after.submitting).toBe(false);
    expect(after.player).toBe(player);
    expect(after.player?.score).toBe(3);
    expect(after.actionError).toEqual(networkError);
  });

  it("guess/reconciling keeps submissions blocked and surfaces the error", () => {
    const before = stateWith({ submitting: true, player });
    const after = gameReducer(before, {
      type: "guess/reconciling",
      error: networkError,
    });
    expect(after.submitting).toBe(true);
    expect(after.player).toBe(player);
    expect(after.actionError).toEqual(networkError);
  });

  it("action/dismiss clears only the action error", () => {
    const before = stateWith({
      submitting: true,
      sessionError: sessionError,
      actionError: networkError,
    });
    const after = gameReducer(before, { type: "action/dismiss" });
    expect(after.actionError).toBeNull();
    expect(after.sessionError).toEqual(sessionError);
    expect(after.submitting).toBe(true);
  });

  it("action/clear clears the action error", () => {
    const after = gameReducer(stateWith({ actionError: networkError }), {
      type: "action/clear",
    });
    expect(after.actionError).toBeNull();
  });

  it("never mutates its input state", () => {
    const before = Object.freeze(
      stateWith({ actionError: networkError, submitting: true }),
    );
    const frozenPlayer = Object.freeze(player);
    const input = Object.freeze({ ...before, player: frozenPlayer });
    const after = gameReducer(input, { type: "guess/result", player });
    expect(after).not.toBe(input);
    expect(input.actionError).toEqual(networkError);
    expect(input.submitting).toBe(true);
    expect(after.player).toBe(player);
  });
});

describe("canSubmitGuess", () => {
  it("allows a guess when ready, idle, and no active guess exists", () => {
    expect(canSubmitGuess(playingState)).toBe(true);
  });

  it("blocks while a submission is in flight", () => {
    expect(canSubmitGuess(stateWith({ submitting: true }))).toBe(false);
  });

  it("blocks while an active guess exists", () => {
    expect(
      canSubmitGuess(stateWith({ player: { ...player, activeGuess } })),
    ).toBe(false);
  });

  it("blocks outside a ready session", () => {
    expect(canSubmitGuess(stateWith({ sessionStatus: "onboarding" }))).toBe(
      false,
    );
    expect(canSubmitGuess(stateWith({ sessionStatus: "checking" }))).toBe(
      false,
    );
    expect(canSubmitGuess(stateWith({ sessionStatus: "error" }))).toBe(false);
  });

  it("blocks when no player is known", () => {
    expect(canSubmitGuess(stateWith({ player: null }))).toBe(false);
  });
});

describe("shouldPoll", () => {
  it("polls only from a ready session", () => {
    expect(shouldPoll(stateWith({ sessionStatus: "ready" }))).toBe(true);
    expect(shouldPoll(stateWith({ sessionStatus: "checking" }))).toBe(false);
    expect(shouldPoll(stateWith({ sessionStatus: "onboarding" }))).toBe(false);
    expect(shouldPoll(stateWith({ sessionStatus: "error" }))).toBe(false);
  });
});

describe("pollDelayMs", () => {
  it("uses the active-guess cadence while a guess is pending", () => {
    expect(pollDelayMs(stateWith({ player: { ...player, activeGuess } }))).toBe(
      ACTIVE_GUESS_POLL_MS,
    );
    expect(ACTIVE_GUESS_POLL_MS).toBe(5000);
  });

  it("uses the idle cadence when there is no active guess", () => {
    expect(pollDelayMs(playingState)).toBe(IDLE_POLL_MS);
    expect(IDLE_POLL_MS).toBe(15000);
  });

  it("uses the idle cadence when no player is known", () => {
    expect(pollDelayMs(stateWith({ player: null }))).toBe(IDLE_POLL_MS);
  });
});
