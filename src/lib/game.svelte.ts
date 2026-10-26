import { onMount } from 'svelte';
import { ApiError, type Guess, type Player, request } from './api';
import { type GameSnapshot, loadGame } from './gameApi';

export function createGame() {
  let player = $state<Player | null>(null);
  let guess = $state<Guess | null>(null);
  let syncing = $state(true);
  let submitting = $state(false);
  let error = $state('');

  let mounted = false;
  let submissionInFlight = false;
  let submissionVersion = 0;
  let pendingGuessId: string | undefined;

  function applySnapshot(current: GameSnapshot) {
    pendingGuessId = current.pendingGuessId;
    player = current.player;

    if (current.guess !== undefined) {
      guess = current.guess;
    }

    syncing = false;
    error = '';
  }

  async function refreshGame(isCancelled: () => boolean) {
    if (submissionInFlight) {
      return;
    }

    const version = submissionVersion;
    const isOutdated = () => isCancelled() || version !== submissionVersion;

    try {
      const current = await loadGame(pendingGuessId, isOutdated);

      if (!current || isOutdated()) {
        return;
      }

      applySnapshot(current);
    } catch (cause) {
      if (!isOutdated()) {
        error =
          cause instanceof ApiError
            ? cause.message
            : 'Could not connect. Retrying automatically…';
      }
    }
  }

  const pending = $derived(
    guess?.status === 'pending' || Boolean(player?.pendingGuessId),
  );
  const disabled = $derived(
    syncing || submitting || pending || !player,
  );

  function applySubmittedGuess(created: Guess) {
    pendingGuessId = created.id;
    guess = created;
    if (player) {
      player = { ...player, pendingGuessId: created.id };
    }
  }

  async function submit(direction: Guess['direction']) {
    if (submissionInFlight || disabled) {
      return;
    }

    submissionInFlight = true;
    submissionVersion += 1;
    submitting = true;
    error = '';

    try {
      const created = await request<Guess>('/guesses', { direction });

      if (!mounted) {
        return;
      }

      applySubmittedGuess(created);
    } catch (cause) {
      if (!mounted) {
        return;
      }

      syncing = true;
      error =
        cause instanceof ApiError
          ? cause.message
          : 'Submission could not be confirmed. Checking your pending guess…';
    } finally {
      submissionInFlight = false;
      if (mounted) {
        submitting = false;
      }
    }
  }

  onMount(() => {
    mounted = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      await refreshGame(() => cancelled);

      if (!cancelled) {
        timer = setTimeout(poll, submissionInFlight ? 1000 : 3000);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      mounted = false;
      clearTimeout(timer);
    };
  });

  return {
    get player() {
      return player;
    },
    get guess() {
      return guess;
    },
    get pending() {
      return pending;
    },
    get syncing() {
      return syncing;
    },
    get submitting() {
      return submitting;
    },
    get disabled() {
      return disabled;
    },
    get error() {
      return error;
    },
    submit,
  };
}
