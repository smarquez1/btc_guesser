import { ApiError, type Guess, type Player, request } from './api';

export interface GameSnapshot {
  player: Player;
  guess: Guess | null | undefined;
  pendingGuessId: string | undefined;
}

async function loadPlayer(isOutdated: () => boolean) {
  try {
    return { player: await request<Player>('/players/me'), identityChanged: false };
  } catch (cause) {
    if (isOutdated() || !(cause instanceof ApiError) || cause.status !== 401) {
      throw cause;
    }
  }

  let player: Player;

  try {
    player = await request<Player>('/players', {});
  } catch (cause) {
    if (isOutdated() || !(cause instanceof ApiError) || cause.status !== 401) {
      throw cause;
    }

    // The rejected creation clears an invalid cookie; retry once without it.
    player = await request<Player>('/players', {});
  }

  return { player, identityChanged: true };
}

export async function loadGame(
  previousPendingId: string | undefined,
  isOutdated: () => boolean,
): Promise<GameSnapshot | null> {
  let { player, identityChanged } = await loadPlayer(isOutdated);

  if (isOutdated()) {
    return null;
  }

  const guessId = player.pendingGuessId ?? (identityChanged ? undefined : previousPendingId);
  // Undefined preserves the displayed result; null clears an obsolete guess.
  let guess: Guess | null | undefined = identityChanged ? null : undefined;

  if (guessId) {
    try {
      guess = await request<Guess>(`/guesses/${guessId}`);
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404 || player.pendingGuessId) {
        throw cause;
      }

      // Another tab resolved the guess and its saved evidence has expired.
      guess = null;
    }

    if (isOutdated()) {
      return null;
    }

    if (guess?.status === 'resolved') {
      player = await request<Player>('/players/me');
    }
  }

  if (isOutdated()) {
    return null;
  }

  return {
    player,
    guess,
    pendingGuessId: guess?.status === 'pending' ? guess.id : player.pendingGuessId,
  };
}
