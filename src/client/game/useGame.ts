// Session + guess orchestration for the game interface.
//
// Everything here is transport and timing; the state decisions live in the pure
// reducer (`./machine`). This hook never reads cookies/storage, never compares
// prices, and never applies score changes locally: mutations are always
// reconciled against the authoritative player returned by `@/api`.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  getPlayer,
  createPlayer as requestCreatePlayer,
  submitGuess as requestSubmitGuess,
  toApiError,
} from "@/api";
import {
  createDiagnostics,
  type DiagnosticEvent,
  reportableError,
} from "@/diagnostics";
import {
  canSubmitGuess,
  type GameAction,
  type GameState,
  gameReducer,
  initialGameState,
  pollDelayMs,
  shouldPoll,
} from "@/game/machine";
import {
  type ApiError,
  type Direction,
  type GameController,
  validateDisplayName,
} from "@/game/types";

const IS_DEV = import.meta.env?.DEV === true;
const COUNTDOWN_TICK_MS = 1000;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * A client-side validation failure. The message is not carried on `ApiError`:
 * the UI derives the exact copy from `validateDisplayName` and the code.
 */
function invalidDisplayNameError(): ApiError {
  return {
    code: "invalid_display_name",
    status: null,
    category: "validation",
    requestId: null,
    retryable: false,
  };
}

export function useGame(): GameController {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const [now, setNow] = useState(() => Date.now());

  // Mirror state synchronously so guards and delay decisions read the latest
  // value even before React commits the corresponding render.
  const stateRef = useRef<GameState>(initialGameState);
  const send = useCallback((action: GameAction) => {
    stateRef.current = gameReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const appliedSequenceRef = useRef(0);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const pollInFlightRef = useRef(false);
  const mutationInFlightRef = useRef(false);

  const diagnosticsRef = useRef<ReturnType<typeof createDiagnostics> | null>(
    null,
  );
  diagnosticsRef.current ??= createDiagnostics({ enabled: IS_DEV });
  const diagnostics = diagnosticsRef.current;

  const nextSequence = useCallback(() => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  }, []);

  const beginRequest = useCallback(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);

  const endRequest = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller);
  }, []);

  const report = useCallback(
    (error: ApiError, operation: DiagnosticEvent["operation"]) => {
      diagnostics.report(reportableError(error, operation));
    },
    [diagnostics],
  );

  // Sequence gate: a slow or stale response can never overwrite a newer one.
  const applyIfNewest = useCallback((sequence: number, apply: () => void) => {
    if (!mountedRef.current) return;
    if (sequence <= appliedSequenceRef.current) return;
    appliedSequenceRef.current = sequence;
    apply();
  }, []);

  const runSessionCheck = useCallback(async () => {
    send({ type: "session/start" });
    const sequence = nextSequence();
    const controller = beginRequest();
    try {
      const player = await getPlayer(controller.signal);
      applyIfNewest(sequence, () => send({ type: "session/ready", player }));
    } catch (error) {
      if (isAbortError(error)) return;
      const apiError = toApiError(error);
      report(apiError, "session");
      applyIfNewest(sequence, () => {
        // Only a confirmed unauthorized response means "new player". Every
        // other failure is recoverable and must not erase a known session.
        if (apiError.code === "unauthorized") {
          send({ type: "session/missing" });
        } else {
          send({ type: "session/failed", error: apiError });
        }
      });
    } finally {
      endRequest(controller);
    }
  }, [applyIfNewest, beginRequest, endRequest, nextSequence, report, send]);

  const refresh = useCallback(async () => {
    const sequence = nextSequence();
    const controller = beginRequest();
    try {
      const player = await getPlayer(controller.signal);
      applyIfNewest(sequence, () => send({ type: "session/ready", player }));
    } catch (error) {
      if (isAbortError(error)) return;
      const apiError = toApiError(error);
      report(apiError, "refresh");
      applyIfNewest(sequence, () =>
        send({ type: "session/failed", error: apiError }),
      );
    } finally {
      endRequest(controller);
    }
  }, [applyIfNewest, beginRequest, endRequest, nextSequence, report, send]);

  // Reconcile a lost/conflicting mutation against the server. Success replaces
  // local state; failure keeps submissions blocked and surfaces the cause.
  const reconcileGuess = useCallback(
    async (cause: ApiError) => {
      const sequence = nextSequence();
      const controller = beginRequest();
      try {
        const player = await getPlayer(controller.signal);
        applyIfNewest(sequence, () => send({ type: "guess/result", player }));
      } catch (error) {
        if (isAbortError(error)) return;
        report(toApiError(error), "refresh");
        applyIfNewest(sequence, () =>
          send({ type: "guess/reconciling", error: cause }),
        );
      } finally {
        endRequest(controller);
      }
    },
    [applyIfNewest, beginRequest, endRequest, nextSequence, report, send],
  );

  const createPlayer = useCallback(
    (displayName: string) => {
      if (stateRef.current.creating) return;

      if (validateDisplayName(displayName) !== null) {
        send({ type: "player/createFailed", error: invalidDisplayNameError() });
        return;
      }

      const sequence = nextSequence();
      const controller = beginRequest();
      mutationInFlightRef.current = true;
      send({ type: "player/creating" });
      void (async () => {
        try {
          const { player } = await requestCreatePlayer(
            displayName,
            controller.signal,
          );
          applyIfNewest(sequence, () =>
            send({ type: "player/created", player }),
          );
        } catch (error) {
          if (isAbortError(error)) return;
          const apiError = toApiError(error);
          report(apiError, "create-player");
          applyIfNewest(sequence, () =>
            send({ type: "player/createFailed", error: apiError }),
          );
        } finally {
          mutationInFlightRef.current = false;
          endRequest(controller);
        }
      })();
    },
    [applyIfNewest, beginRequest, endRequest, nextSequence, report, send],
  );

  const submitGuess = useCallback(
    (direction: Direction) => {
      if (!canSubmitGuess(stateRef.current)) return;

      const sequence = nextSequence();
      const controller = beginRequest();
      mutationInFlightRef.current = true;
      send({ type: "guess/submitting", direction });
      void (async () => {
        try {
          const player = await requestSubmitGuess(direction, controller.signal);
          applyIfNewest(sequence, () => send({ type: "guess/result", player }));
        } catch (error) {
          if (isAbortError(error)) return;
          const apiError = toApiError(error);
          report(apiError, "submit-guess");

          if (apiError.code === "unauthorized") {
            // Session expired: re-run the check so the player is re-onboarded
            // instead of being left with a broken submission.
            await runSessionCheck();
          } else if (apiError.code === "price_unavailable") {
            // Definitive provider failure; a later refresh may re-enable.
            applyIfNewest(sequence, () =>
              send({ type: "guess/failed", error: apiError }),
            );
          } else if (apiError.code === "active_guess" || apiError.retryable) {
            // Conflict or an uncertain outcome: never re-enable on our own.
            await reconcileGuess(apiError);
          } else {
            applyIfNewest(sequence, () =>
              send({ type: "guess/failed", error: apiError }),
            );
          }
        } finally {
          mutationInFlightRef.current = false;
          endRequest(controller);
        }
      })();
    },
    [
      applyIfNewest,
      beginRequest,
      endRequest,
      nextSequence,
      reconcileGuess,
      report,
      runSessionCheck,
      send,
    ],
  );

  const retrySession = useCallback(() => {
    void runSessionCheck();
  }, [runSessionCheck]);

  const refreshLatest = useCallback(() => {
    void refresh();
  }, [refresh]);

  const dismissActionError = useCallback(() => {
    send({ type: "action/dismiss" });
  }, [send]);

  // Initial session check. `runSessionCheck` is stable, so this runs once.
  useEffect(() => {
    void runSessionCheck();
  }, [runSessionCheck]);

  // Abort everything and stop updating state once unmounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const controller of controllersRef.current) {
        controller.abort();
      }
      controllersRef.current.clear();
    };
  }, []);

  const polling = shouldPoll(state);
  const activeGuessId = state.player?.activeGuess?.id ?? null;

  // Recursive timeout loop: no overlap, cadence re-read after each settle.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (cancelled || !mountedRef.current) return;
      // Skip a tick while any request (poll or mutation/reconcile) is running.
      if (pollInFlightRef.current || mutationInFlightRef.current) {
        schedule(pollDelayMs(stateRef.current));
        return;
      }
      pollInFlightRef.current = true;
      const sequence = nextSequence();
      const controller = beginRequest();
      try {
        const player = await getPlayer(controller.signal);
        applyIfNewest(sequence, () => send({ type: "session/ready", player }));
      } catch (error) {
        if (!isAbortError(error)) {
          // Bounded diagnostic; keep the previous state and retry on cadence.
          report(toApiError(error), "refresh");
        }
      } finally {
        pollInFlightRef.current = false;
        endRequest(controller);
        if (!cancelled && mountedRef.current) {
          schedule(pollDelayMs(stateRef.current));
        }
      }
    };

    schedule(pollDelayMs(stateRef.current));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    applyIfNewest,
    beginRequest,
    endRequest,
    nextSequence,
    polling,
    report,
    send,
  ]);

  // Countdown display aid only: ticks while a guess is pending, never resolves
  // and never touches score or submission gating.
  useEffect(() => {
    if (activeGuessId === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [activeGuessId]);

  // Reset bounded diagnostics when the player identity changes.
  const previousSessionStatusRef = useRef(state.sessionStatus);
  useEffect(() => {
    const previous = previousSessionStatusRef.current;
    const next = state.sessionStatus;
    previousSessionStatusRef.current = next;
    const involvesIdentity = (status: string) =>
      status === "onboarding" || status === "ready";
    if (
      previous !== next &&
      involvesIdentity(previous) &&
      involvesIdentity(next)
    ) {
      diagnostics.reset();
    }
  }, [diagnostics, state.sessionStatus]);

  return useMemo<GameController>(
    () => ({
      sessionStatus: state.sessionStatus,
      player: state.player,
      now,
      creating: state.creating,
      submitting: state.submitting,
      pendingDirection: state.pendingDirection,
      sessionError: state.sessionError,
      actionError: state.actionError,
      createPlayer,
      submitGuess,
      retrySession,
      refresh: refreshLatest,
      dismissActionError,
    }),
    [
      createPlayer,
      dismissActionError,
      now,
      refreshLatest,
      retrySession,
      state.actionError,
      state.creating,
      state.player,
      state.pendingDirection,
      state.sessionError,
      state.sessionStatus,
      state.submitting,
      submitGuess,
    ],
  );
}
