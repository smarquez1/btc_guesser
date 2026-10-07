// Session + guess orchestration for the game interface.
//
// Plain React state and effects: no reducer, no state library. This hook does
// four things — call the backend, hold the last authoritative player, poll for
// resolution, and expose retry/dismiss actions. It never compares prices, never
// applies score changes locally, and never decides outcomes: mutations are always
// reconciled against the authoritative player returned by `@/api`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPlayer,
  createPlayer as requestCreatePlayer,
  submitGuess as requestSubmitGuess,
  toApiError,
} from "@/api";
import type {
  ApiError,
  Direction,
  GameController,
  PlayerState,
  SessionStatus,
} from "@/game/types";

const ACTIVE_GUESS_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;
const COUNTDOWN_TICK_MS = 1_000;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** An ambiguous failure: the request may or may not have reached the server. */
function isUncertain(error: ApiError): boolean {
  return error.status === null || error.status >= 500;
}

export function useGame(): GameController {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDirection, setPendingDirection] = useState<Direction | null>(
    null,
  );
  const [sessionError, setSessionError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mounted = useRef(true);
  // Sequence gate: a slow or stale response can never overwrite a newer one.
  const sequence = useRef(0);
  const applied = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const mutationInFlight = useRef(false);
  const creatingRef = useRef(false);

  // Mirrors of state read by guards and timers, so they see the latest values.
  const playerRef = useRef<PlayerState | null>(player);
  playerRef.current = player;
  const statusRef = useRef<SessionStatus>(sessionStatus);
  statusRef.current = sessionStatus;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;

  // Abort everything and stop updating state once unmounted.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);

  const beginRequest = useCallback(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }, []);

  const endRequest = useCallback((controller: AbortController) => {
    controllers.current.delete(controller);
  }, []);

  // Authoritative server state replaces local state and clears transient flags.
  const applyPlayer = useCallback((next: PlayerState) => {
    setPlayer(next);
    setSessionStatus("ready");
    setCreating(false);
    setSubmitting(false);
    setPendingDirection(null);
    setSessionError(null);
    setActionError(null);
  }, []);

  // One player-fetch lifecycle shared by the session check, refresh, reconcile,
  // and poll. A newer request makes an older settled response a no-op.
  const fetchPlayer = useCallback(
    async (handlers: {
      onSuccess?: (next: PlayerState) => void;
      onFailure?: (error: ApiError) => void;
    }): Promise<void> => {
      const id = ++sequence.current;
      const controller = beginRequest();
      try {
        const next = await getPlayer(controller.signal);
        if (mounted.current && id > applied.current) {
          applied.current = id;
          handlers.onSuccess?.(next);
        }
      } catch (error) {
        if (isAbortError(error) || !mounted.current) return;
        if (id > applied.current) {
          applied.current = id;
          handlers.onFailure?.(toApiError(error));
        }
      } finally {
        endRequest(controller);
      }
    },
    [beginRequest, endRequest],
  );

  const runSessionCheck = useCallback(async () => {
    setSessionStatus("checking");
    await fetchPlayer({
      onSuccess: applyPlayer,
      onFailure: (error) => {
        // Only a confirmed unauthorized response means "new player". Any other
        // failure is recoverable and must not erase a known session.
        if (error.code === "unauthorized") {
          setPlayer(null);
          setSessionStatus("onboarding");
          setCreating(false);
          setSubmitting(false);
          setPendingDirection(null);
          setActionError(null);
        } else if (playerRef.current) {
          setSessionStatus("ready");
          setSessionError(error);
        } else {
          setSessionStatus("error");
          setSessionError(error);
        }
      },
    });
  }, [applyPlayer, fetchPlayer]);

  const refresh = useCallback(() => {
    void fetchPlayer({ onSuccess: applyPlayer, onFailure: setSessionError });
  }, [applyPlayer, fetchPlayer]);

  // Reconcile an ambiguous mutation. A failed reconcile keeps submissions
  // blocked and surfaces the cause; a later authoritative poll unblocks.
  const reconcile = useCallback(
    async (cause: ApiError) => {
      const id = ++sequence.current;
      const controller = beginRequest();
      try {
        const next = await getPlayer(controller.signal);
        if (mounted.current && id > applied.current) {
          applied.current = id;
          applyPlayer(next);
        }
      } catch (error) {
        if (isAbortError(error) || !mounted.current) return;
        setActionError(cause);
      } finally {
        endRequest(controller);
      }
    },
    [applyPlayer, beginRequest, endRequest],
  );

  const createPlayer = useCallback(
    (displayName: string) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);
      setActionError(null);
      const id = ++sequence.current;
      const controller = beginRequest();
      mutationInFlight.current = true;
      void (async () => {
        try {
          const { player: next } = await requestCreatePlayer(
            displayName,
            controller.signal,
          );
          if (mounted.current && id > applied.current) {
            applied.current = id;
            applyPlayer(next);
          }
        } catch (error) {
          if (isAbortError(error)) return;
          if (mounted.current && id > applied.current) {
            applied.current = id;
            setActionError(toApiError(error));
          }
        } finally {
          creatingRef.current = false;
          mutationInFlight.current = false;
          endRequest(controller);
          if (mounted.current) setCreating(false);
        }
      })();
    },
    [applyPlayer, beginRequest, endRequest],
  );

  const canSubmit = useCallback(() => {
    const current = playerRef.current;
    return (
      statusRef.current === "ready" &&
      current !== null &&
      current.activeGuess === null &&
      !submittingRef.current
    );
  }, []);

  const submitGuess = useCallback(
    (direction: Direction) => {
      if (!canSubmit()) return;
      setSubmitting(true);
      setPendingDirection(direction);
      setActionError(null);
      const id = ++sequence.current;
      const controller = beginRequest();
      mutationInFlight.current = true;
      void (async () => {
        try {
          const next = await requestSubmitGuess(direction, controller.signal);
          if (mounted.current && id > applied.current) {
            applied.current = id;
            applyPlayer(next);
          }
        } catch (error) {
          if (isAbortError(error) || !mounted.current) return;
          const apiError = toApiError(error);
          if (apiError.code === "unauthorized") {
            // Session expired: re-run the check so the player is re-onboarded.
            await runSessionCheck();
          } else if (
            apiError.code === "active_guess" ||
            isUncertain(apiError)
          ) {
            // Conflict or uncertain outcome: never re-enable on our own.
            await reconcile(apiError);
          } else {
            setSubmitting(false);
            setPendingDirection(null);
            setActionError(apiError);
          }
        } finally {
          mutationInFlight.current = false;
          endRequest(controller);
        }
      })();
    },
    [
      applyPlayer,
      beginRequest,
      canSubmit,
      endRequest,
      reconcile,
      runSessionCheck,
    ],
  );

  const retrySession = useCallback(() => {
    void runSessionCheck();
  }, [runSessionCheck]);

  const dismissActionError = useCallback(() => setActionError(null), []);

  // Initial session check. `runSessionCheck` is stable, so this runs once.
  useEffect(() => {
    void runSessionCheck();
  }, [runSessionCheck]);

  const activeGuessId = player?.activeGuess?.id ?? null;
  const polling = sessionStatus === "ready";

  // Recursive timeout loop: no overlap, cadence re-read after each settle.
  // `activeGuessId` is the cadence trigger, so ready→pending applies the 5s
  // active cadence immediately rather than after an idle tick.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled || !mounted.current) return;
      if (mutationInFlight.current) {
        schedule(activeGuessId === null ? IDLE_POLL_MS : ACTIVE_GUESS_POLL_MS);
        return;
      }
      // On failure the previous state is kept; the next tick is on cadence.
      await fetchPlayer({ onSuccess: applyPlayer });
      if (!cancelled && mounted.current) {
        schedule(
          playerRef.current?.activeGuess ? ACTIVE_GUESS_POLL_MS : IDLE_POLL_MS,
        );
      }
    };

    schedule(activeGuessId === null ? IDLE_POLL_MS : ACTIVE_GUESS_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [activeGuessId, applyPlayer, fetchPlayer, polling]);

  // Countdown display aid only: ticks while a guess is pending, never resolves
  // and never touches score or submission gating.
  useEffect(() => {
    if (activeGuessId === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [activeGuessId]);

  return useMemo<GameController>(
    () => ({
      sessionStatus,
      player,
      now,
      creating,
      submitting,
      pendingDirection,
      sessionError,
      actionError,
      createPlayer,
      submitGuess,
      retrySession,
      refresh,
      dismissActionError,
    }),
    [
      actionError,
      createPlayer,
      creating,
      dismissActionError,
      now,
      pendingDirection,
      player,
      refresh,
      retrySession,
      sessionError,
      sessionStatus,
      submitGuess,
      submitting,
    ],
  );
}
