import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessService, resolveGuess } from '../server/services/guesses.ts';
import type { Guess } from '../server/types/guess.ts';
import type { PriceState } from '../server/types/price.ts';

const now = 1800000000;
const pending: Guess = {
  id: '6e6680df-e78f-4c44-b1d4-45d27218b82d', playerId: 'player',
  direction: 'up', status: 'pending', startingPrice: 100,
  startingObservedAt: now - 61, startedAt: now - 60, deadline: now,
};
const price: PriceState = { symbol: 'BTC-USD', price: 101, observedAt: now, stale: false };

function setup(initial: Guess | undefined = pending) {
  let saved = initial;
  const repository = {
    get: async (_id: string): Promise<Guess | undefined> => saved,
    create: async (guess: Guess) => { saved = guess; return true; },
    resolve: async (guess: Guess) => { saved = guess; return true; },
  };
  const prices = { get: async (): Promise<PriceState | undefined> => price };

  return { repository, prices, service: guessService(repository, prices) };
}

test('resolution requires elapsed deadline, eligible source time, and a different price', () => {
  for (const [observation, clock] of [
    [price, now - 1],
    [{ ...price, observedAt: now - 1 }, now],
    [{ ...price, observedAt: now + 1 }, now],
    [{ ...price, price: 100 }, now],
  ] as const) {
    assert.equal(resolveGuess(pending, observation, clock), pending);
  }
  const resolved = resolveGuess(pending, price, now);

  assert.equal(resolveGuess(resolved, { ...price, price: 99 }, now + 1), resolved);
  assert.equal(pending.status, 'pending');
});

test('all direction and movement combinations produce deterministic evidence and score deltas', () => {
  for (const direction of ['up', 'down'] as const) {
    for (const finalPrice of [99, 101]) {
      const guess = { ...pending, direction };
      const correct = (direction === 'up') === (finalPrice > 100);
      const resolved = resolveGuess(guess, { ...price, price: finalPrice, stale: true }, now);

      assert.deepEqual(resolved, {
        ...guess, status: 'resolved', finalPrice, finalObservedAt: now,
        resolvedAt: now, correct, scoreDelta: correct ? 1 : -1, expiresAt: now + 86400,
      });
    }
  }
});

test('submission owns start, source time and deadline and reports atomic conflict', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000 + 999);
  const { repository, prices, service } = setup();
  prices.get = async () => ({ ...price, observedAt: now - 2 });
  const result = await service.submit('player', 'down');

  assert.equal(result.outcome, 'created');
  if (result.outcome !== 'created') throw new Error('Expected created guess');

  assert.match(result.guess.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.guess, {
    id: result.guess.id, playerId: 'player', direction: 'down', status: 'pending',
    startingPrice: 101, startingObservedAt: now - 2, startedAt: now, deadline: now + 60,
  });
  repository.create = async () => false;
  assert.deepEqual(await service.submit('player', 'up'), { outcome: 'conflict' });
});

test('submission refuses missing and stale pricing without writing', async () => {
  const { repository, prices, service } = setup();
  repository.create = async () => { throw new Error('Unexpected write'); };

  for (const observation of [undefined, { ...price, stale: true }]) {
    prices.get = async () => observation;
    assert.deepEqual(await service.submit('player', 'up'), { outcome: 'unavailable' });
  }
});

test('lookup rejects missing, foreign and expired guesses before pricing', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);

  for (const guess of [undefined, { ...pending, playerId: 'other' },
    { ...resolveGuess(pending, price, now), expiresAt: now }]) {
    const store = setup();
    store.repository.get = async () => guess;
    store.prices.get = async () => { throw new Error('Unexpected pricing'); };
    assert.equal(await store.service.get('player', pending.id), undefined);
  }
});

test('early and resolved lookups do not fetch pricing', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);

  for (const guess of [{ ...pending, deadline: now + 1 }, resolveGuess(pending, price, now)]) {
    const { prices, service } = setup(guess);
    prices.get = async () => { throw new Error('Unexpected pricing'); };
    assert.deepEqual(await service.get('player', pending.id), guess);
  }
});

test('missing and ineligible observations leave guesses pending without writes', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const { repository, prices, service } = setup();
  repository.resolve = async () => { throw new Error('Unexpected resolution'); };

  for (const observation of [undefined, { ...price, price: 100 }, { ...price, observedAt: now - 1 }]) {
    prices.get = async () => observation;
    assert.deepEqual(await service.get('player', pending.id), pending);
  }
});

test('resolution uses committed winner after conflict and rejects inconsistent storage', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const { repository, service } = setup();
  const winner = resolveGuess(pending, { ...price, price: 99 }, now);
  repository.resolve = async () => {
    repository.get = async () => winner;

    return false;
  };
  assert.deepEqual(await service.get('player', pending.id), winner);
  repository.get = async () => pending;
  repository.resolve = async () => false;
  await assert.rejects(service.get('player', pending.id), /did not produce a result/);
});

test('eligible stale observation resolves and storage errors propagate', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const { repository, prices, service } = setup();
  prices.get = async () => ({ ...price, stale: true });
  assert.deepEqual(await service.get('player', pending.id), resolveGuess(pending, price, now));
  repository.get = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(service.get('player', pending.id), /Storage unavailable/);
});
