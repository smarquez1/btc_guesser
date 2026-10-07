import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type Guess, type Player, request } from '../lib/api';
import { type GameSnapshot, loadGame } from '../lib/gameApi';

export function useGame() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  // Guard rapid submissions synchronously and discard older polling responses.
  const submissionInFlight = useRef(false);
  const submissionVersion = useRef(0);
  // Retain the ID even when another tab clears it from the player profile.
  const pendingGuessId = useRef<string | undefined>(undefined);

  const applySnapshot = useCallback((current: GameSnapshot) => {
    pendingGuessId.current = current.pendingGuessId;
    setPlayer(current.player);
    if (current.guess !== undefined) {
      setGuess(current.guess);
    }

    setSyncing(false);
    setError('');
  }, []);

  const refreshGame = useCallback(async (isCancelled: () => boolean) => {
    if (submissionInFlight.current) {
      return;
    }

    const version = submissionVersion.current;
    const isOutdated = () => isCancelled() || version !== submissionVersion.current;

    try {
      const current = await loadGame(pendingGuessId.current, isOutdated);

      if (!current || isOutdated()) {
        return;
      }

      applySnapshot(current);
    } catch (cause) {
      if (!isOutdated()) {
        setError(cause instanceof ApiError ? cause.message : 'Could not connect. Retrying automatically…');
      }
    }
  }, [applySnapshot]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      await refreshGame(() => cancelled);

      if (!cancelled) {
        timer = setTimeout(poll, submissionInFlight.current ? 1000 : 3000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [refreshGame]);

  const pending = guess?.status === 'pending' || Boolean(player?.pendingGuessId);
  const disabled = syncing || submitting || pending || !player;

  function applySubmittedGuess(created: Guess) {
    pendingGuessId.current = created.id;
    setGuess(created);
    setPlayer((current) => current ? { ...current, pendingGuessId: created.id } : current);
  }

  async function submit(direction: Guess['direction']) {
    if (submissionInFlight.current || disabled) {
      return;
    }

    submissionInFlight.current = true;
    submissionVersion.current += 1;
    setSubmitting(true);
    setError('');

    try {
      const created = await request<Guess>('/guesses', { direction });

      if (!mounted.current) {
        return;
      }

      applySubmittedGuess(created);
    } catch (cause) {
      if (!mounted.current) {
        return;
      }

      setSyncing(true);
      setError(cause instanceof ApiError ? cause.message : 'Submission could not be confirmed. Checking your pending guess…');
    } finally {
      submissionInFlight.current = false;
      if (mounted.current) {
        setSubmitting(false);
      }
    }
  }

  return { player, guess, pending, syncing, submitting, disabled, error, submit };
}
