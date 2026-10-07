import { randomUUID } from 'node:crypto';
import type { guessRepository } from '../repositories/guesses.ts';
import type { priceService } from './prices.ts';
import type { Guess } from '../types/guess.ts';
import type { PriceState } from '../types/price.ts';

const resolvedRetentionSeconds = 86400;

export function resolveGuess(guess: Guess, price: PriceState, now: number): Guess {
  if (guess.status !== 'pending' || now < guess.deadline ||
    price.observedAt < guess.deadline || price.observedAt > now ||
    price.price === guess.startingPrice) {
    return guess;
  }

  const correct = (price.price > guess.startingPrice) === (guess.direction === 'up');

  return {
    ...guess,
    status: 'resolved',
    resolvedAt: now,
    finalPrice: price.price,
    finalObservedAt: price.observedAt,
    correct,
    scoreDelta: correct ? 1 : -1,
    expiresAt: now + resolvedRetentionSeconds,
  };
}

export function guessService(
  repository: ReturnType<typeof guessRepository>,
  prices: ReturnType<typeof priceService>,
) {
  return {
    async submit(playerId: string, direction: Guess['direction']) {
      const price = await prices.get();

      if (!price || price.stale) return { outcome: 'unavailable' } as const;

      const now = Math.floor(Date.now() / 1000);
      const guess: Guess = {
        id: randomUUID(),
        playerId,
        direction,
        status: 'pending',
        startingPrice: price.price,
        startingObservedAt: price.observedAt,
        startedAt: now,
        deadline: now + 60,
      };
      const created = await repository.create(guess);

      return created
        ? { outcome: 'created', guess } as const
        : { outcome: 'conflict' } as const;
    },

    async get(playerId: string, id: string): Promise<Guess | undefined> {
      const guess = await repository.get(id);
      const now = Math.floor(Date.now() / 1000);

      if (!guess || guess.playerId !== playerId ||
        (guess.expiresAt !== undefined && guess.expiresAt <= now)) {
        return undefined;
      }

      if (guess.status === 'resolved' || now < guess.deadline) return guess;

      const price = await prices.get();

      if (!price) return guess;

      const resolved = resolveGuess(guess, price, Math.floor(Date.now() / 1000));

      if (resolved === guess) return guess;

      if (await repository.resolve(resolved)) return resolved;

      // A concurrent resolver may have committed different eligible evidence.
      const saved = await repository.get(id);

      if (!saved || saved.playerId !== playerId || saved.status !== 'resolved') {
        throw new Error('Guess resolution transaction did not produce a result');
      }

      return saved;
    },
  };
}
