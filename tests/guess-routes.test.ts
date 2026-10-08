import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import { buildApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { guessRoutes } from '../server/routes/guesses.ts';
import type { guessService } from '../server/services/guesses.ts';
import type { Guess } from '../server/types/guess.ts';
import type { Player } from '../server/types/player.ts';

const id = '6e6680df-e78f-4c44-b1d4-45d27218b82d';
const pending: Guess = {
  id, playerId: 'private', direction: 'up', status: 'pending', startingPrice: 100,
  startingObservedAt: 1, startedAt: 2, deadline: 62,
};
const config = loadConfig({
  AWS_REGION: 'us-east-1', DYNAMODB_TABLE: 'test-table', APP_ORIGIN: 'https://game.example',
});
const headers = { cookie: `btc_player=${id}` };

function setup() {
  const app = buildApp();
  const players = {
    find: async (identity: string | undefined): Promise<Player | undefined> => identity === id
      ? { id: 'private', name: 'Player', score: 0, createdAt: 1 } : undefined,
    create: async (): Promise<Player> => { throw new Error('unexpected creation'); },
  };
  const guesses: ReturnType<typeof guessService> = {
    submit: async () => ({ outcome: 'created', guess: pending }),
    get: async () => pending,
  };
  app.register(cookie);
  app.register(guessRoutes, { config, players, guesses });

  return { app, players, guesses };
}

test('guess routes expose public pending and resolved evidence with no-store', async (t) => {
  const { app, guesses } = setup();
  t.after(() => app.close());
  const submitted = await app.inject({ method: 'POST', url: '/api/guesses', headers, payload: { direction: 'up' } });

  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.json().playerId, undefined);
  assert.equal(submitted.json().deadline, 62);
  assert.equal(submitted.headers['cache-control'], 'no-store');
  guesses.get = async () => ({ ...pending, status: 'resolved', finalPrice: 99,
    finalObservedAt: 62, resolvedAt: 63, correct: false, scoreDelta: -1, expiresAt: 86463 });
  const resolved = await app.inject({ url: `/api/guesses/${id}`, headers });

  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().correct, false);
  assert.equal(resolved.json().scoreDelta, -1);
  assert.equal(resolved.json().playerId, undefined);
  assert.equal(resolved.json().expiresAt, undefined);
  assert.equal(resolved.headers['cache-control'], 'no-store');
});

test('invalid guess inputs and foreign origins are rejected before submission', async (t) => {
  const { app, guesses } = setup();
  t.after(() => app.close());
  guesses.submit = async () => { throw new Error('Unexpected submission'); };

  for (const payload of [{}, { direction: 'sideways' }, { direction: 'up', score: 99 },
    { direction: 'down', startingPrice: 1 }, [], null, 'up']) {
    const response = await app.inject({ method: 'POST', url: '/api/guesses', headers: {
      ...headers, 'content-type': 'application/json',
    }, payload: JSON.stringify(payload) });

    assert.equal(response.statusCode, 400);
  }
  for (const foreign of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/guesses',
      headers: { ...headers, ...foreign }, payload: { direction: 'up' } });

    assert.equal(response.statusCode, 403);
  }
});

test('guess routes reject identities, invalid IDs, and unknown guesses', async (t) => {
  const { app, guesses } = setup();
  t.after(() => app.close());

  for (const cookieValue of ['', 'btc_player=invalid']) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/guesses',
      headers: { cookie: cookieValue }, payload: { direction: 'up' } })).statusCode, 401);
    assert.equal((await app.inject({ url: `/api/guesses/${id}`, headers: { cookie: cookieValue } })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/api/guesses/invalid', headers })).statusCode, 400);
  guesses.get = async () => undefined;
  assert.equal((await app.inject({ url: `/api/guesses/${id}`, headers })).statusCode, 404);
});

test('pending profiles and racing submissions return conflict; unavailable prices return retry hint', async (t) => {
  const { app, players, guesses } = setup();
  t.after(() => app.close());
  const submit = () => app.inject({ method: 'POST', url: '/api/guesses', headers, payload: { direction: 'down' } });
  guesses.submit = async () => ({ outcome: 'conflict' });
  assert.equal((await submit()).statusCode, 409);
  guesses.submit = async () => ({ outcome: 'unavailable' });
  const unavailable = await submit();

  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.headers['retry-after'], '5');
  players.find = async () => ({ id: 'private', name: 'Player', score: 0, createdAt: 1, pendingGuessId: id });
  guesses.submit = async () => { throw new Error('Unexpected submission'); };
  assert.equal((await submit()).statusCode, 409);
});

test('guess routes hide storage errors', async (t) => {
  const { app, guesses } = setup();
  t.after(() => app.close());
  guesses.submit = async () => { throw new Error('Private details'); };
  guesses.get = async () => { throw new Error('Private details'); };

  for (const options of [
    { method: 'POST' as const, url: '/api/guesses', headers, payload: { direction: 'up' } },
    { method: 'GET' as const, url: `/api/guesses/${id}`, headers },
  ]) {
    const response = await app.inject(options);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal server error' });
  }
});
