import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import view from '@fastify/view';
import ejs from 'ejs';
import { resolve } from 'node:path';
import { buildApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { gameRoutes } from '../server/routes/game.ts';
import type { Guess } from '../server/types/guess.ts';
import type { Player } from '../server/types/player.ts';
import type { PriceState } from '../server/types/price.ts';

const playerId = '6e6680df-e78f-4c44-b1d4-45d27218b82d';
const guessId = '123e4567-e89b-42d3-a456-426614174000';
const config = loadConfig({
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE: 'test-table',
  APP_ORIGIN: 'https://game.example',
  COOKIE_SECURE: 'true',
});

function setup() {
  let player: Player | undefined = {
    id: playerId,
    name: '<Player>',
    score: 0,
    createdAt: 1800000000,
  };
  let guess: Guess | undefined;
  let price: PriceState | undefined = {
    symbol: 'BTC-USD',
    price: 60_000,
    observedAt: Math.floor(Date.now() / 1000),
    stale: false,
  };
  let playerCreates = 0;
  let submissions = 0;
  let findCalls = 0;
  let findFailure: Error | undefined;

  const players = {
    async find(identity: string | undefined) {
      findCalls += 1;

      if (findFailure) throw findFailure;

      return identity === playerId ? player : undefined;
    },
    async create() {
      playerCreates += 1;
      player = {
        id: playerId,
        name: '<Player>',
        score: 0,
        createdAt: 1800000000,
      };

      return player;
    },
  };

  const prices = {
    async get() {
      return price;
    },
  };

  const guesses = {
    async submit(id: string, direction: Guess['direction']) {
      submissions += 1;

      if (!player || player.pendingGuessId) return { outcome: 'conflict' } as const;
      if (!price || price.stale) return { outcome: 'unavailable' } as const;

      guess = {
        id: guessId,
        playerId: id,
        direction,
        status: 'pending',
        startingPrice: price.price,
        startingObservedAt: price.observedAt,
        startedAt: Math.floor(Date.now() / 1000),
        deadline: Math.floor(Date.now() / 1000) + 60,
      };
      player.pendingGuessId = guess.id;

      return { outcome: 'created', guess } as const;
    },
    async get(id: string, requestedGuessId: string) {
      return id === playerId && guess?.id === requestedGuessId ? guess : undefined;
    },
  };

  const app = buildApp();
  app.register(cookie);
  app.register(formbody);
  app.register(view, {
    engine: { ejs },
    root: resolve(import.meta.dirname, '../server/views'),
  });
  app.register(gameRoutes, { config, players, prices, guesses });

  return {
    app,
    players,
    guesses,
    state: {
      get player() { return player; },
      set player(value: Player | undefined) { player = value; },
      get guess() { return guess; },
      set guess(value: Guess | undefined) { guess = value; },
      get price() { return price; },
      set price(value: PriceState | undefined) { price = value; },
      get playerCreates() { return playerCreates; },
      get submissions() { return submissions; },
      get findCalls() { return findCalls; },
      set findFailure(value: Error | undefined) { findFailure = value; },
    },
  };
}

const playerCookie = `btc_player=${playerId}`;

test('session reuses a valid /api identity and renders escaped public player state', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/ui/session',
    headers: { cookie: playerCookie, origin: config.appOrigin },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/html/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /&lt;Player&gt;/);
  assert.doesNotMatch(response.body, new RegExp(playerId));
  assert.match(String(response.headers['set-cookie']), /Path=\/api/);
  assert.equal(context.state.playerCreates, 0);
});

test('session creates a replacement identity for an invalid cookie without accepting client state', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/ui/session',
    headers: { cookie: 'btc_player=invalid', origin: config.appOrigin },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(context.state.playerCreates, 1);
  assert.match(String(response.headers['set-cookie']), /Path=\/api/);
  assert.match(response.body, /&lt;Player&gt;/);

  const rejected = await context.app.inject({
    method: 'POST',
    url: '/api/ui/session',
    headers: { origin: config.appOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'score=100',
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(context.state.playerCreates, 1);
});

test('session rejects cross-site requests and does not create a player on storage errors', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  context.state.findFailure = new Error('private database details');

  const failure = await context.app.inject({
    method: 'POST', url: '/api/ui/session',
    headers: { cookie: playerCookie, origin: config.appOrigin },
  });
  assert.equal(failure.statusCode, 500);
  assert.doesNotMatch(failure.body, /private database details/);
  assert.equal(context.state.playerCreates, 0);

  context.state.findFailure = undefined;
  const crossSite = await context.app.inject({
    method: 'POST', url: '/api/ui/session',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(context.state.playerCreates, 0);
});

test('game state prefers the current pending guess over a remembered result ID', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const pending: Guess = {
    id: guessId,
    playerId,
    direction: 'up',
    status: 'pending',
    startingPrice: 59_000,
    startingObservedAt: 1800000000,
    startedAt: 1800000000,
    deadline: Math.floor(Date.now() / 1000) + 60,
  };
  const currentPlayer = context.state.player;
  assert.ok(currentPlayer);
  context.state.player = { ...currentPlayer, pendingGuessId: guessId };
  context.state.guess = pending;

  const response = await context.app.inject({
    url: `/api/ui/game?guessId=${playerId}`,
    headers: { cookie: playerCookie },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Your guess:/);
  assert.match(response.body, /aria-pressed="true"/);
  assert.match(response.body, /disabled/);
  assert.match(response.body, /data-guess-id="123e4567-e89b-42d3-a456-426614174000"/);
  assert.equal(context.state.findCalls, 1);
});

test('resolved state refreshes score and displays the result observation immediately', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const observedAt = Math.floor(Date.now() / 1000);
  const currentPlayer = context.state.player;
  assert.ok(currentPlayer);
  context.state.player = { ...currentPlayer, score: 1 };
  context.state.guess = {
    id: guessId,
    playerId,
    direction: 'up',
    status: 'resolved',
    startingPrice: 60_000,
    startingObservedAt: observedAt - 60,
    startedAt: observedAt - 60,
    deadline: observedAt,
    finalPrice: 60_100,
    finalObservedAt: observedAt,
    correct: true,
    scoreDelta: 1,
    resolvedAt: observedAt,
  };
  context.state.price = {
    symbol: 'BTC-USD', price: 60_000, observedAt: observedAt - 1, stale: false,
  };

  const response = await context.app.inject({
    url: `/api/ui/game?guessId=${guessId}`,
    headers: { cookie: playerCookie },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /data-score>1<\/strong>/);
  assert.match(response.body, /\$60,100\.00/);
  assert.match(response.body, /Correct! \+1 point/);
  assert.match(response.body, /text-green-700/);
  assert.equal(context.state.findCalls, 2);
});

test('unavailable and stale prices remain visible but disable new guesses', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  context.state.price = {
    symbol: 'BTC-USD', price: 60_000, observedAt: Math.floor(Date.now() / 1000) - 10, stale: true,
  };

  const response = await context.app.inject({
    url: '/api/ui/game', headers: { cookie: playerCookie },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /\$60,000\.00/);
  assert.match(response.body, /Last available price/);
  assert.match(response.body, /disabled/);
});

test('guess form accepts only a direction and returns reconciled HTML state', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/ui/guesses',
    headers: {
      cookie: playerCookie,
      origin: config.appOrigin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'direction=down',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Your guess:/);
  assert.match(response.body, /DOWN/);
  assert.equal(context.state.submissions, 1);
  assert.equal(context.state.player?.pendingGuessId, guessId);

  const invalid = await context.app.inject({
    method: 'POST',
    url: '/api/ui/guesses',
    headers: {
      cookie: playerCookie,
      origin: config.appOrigin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'direction=up&score=100',
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /Choose higher or lower/);
  assert.equal(context.state.submissions, 1);
});

test('guess conflicts render current pending state and unavailable prices do not persist a guess', async (t) => {
  const context = setup();
  t.after(() => context.app.close());
  const currentPlayer = context.state.player;
  assert.ok(currentPlayer);
  context.state.player = { ...currentPlayer, pendingGuessId: guessId };
  context.state.guess = {
    id: guessId,
    playerId,
    direction: 'up',
    status: 'pending',
    startingPrice: 60_000,
    startingObservedAt: Math.floor(Date.now() / 1000),
    startedAt: Math.floor(Date.now() / 1000),
    deadline: Math.floor(Date.now() / 1000) + 60,
  };

  const conflict = await context.app.inject({
    method: 'POST',
    url: '/api/ui/guesses',
    headers: {
      cookie: playerCookie,
      origin: config.appOrigin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'direction=down',
  });

  assert.equal(conflict.statusCode, 200);
  assert.match(conflict.body, /A guess is already pending/);
  assert.match(conflict.body, /Your guess:.*UP/);

  const pendingPlayer = context.state.player;
  assert.ok(pendingPlayer);
  context.state.player = { ...pendingPlayer, pendingGuessId: undefined };
  context.state.guess = undefined;
  context.state.price = undefined;
  const unavailable = await context.app.inject({
    method: 'POST',
    url: '/api/ui/guesses',
    headers: {
      cookie: playerCookie,
      origin: config.appOrigin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'direction=down',
  });

  assert.equal(unavailable.statusCode, 200);
  assert.match(unavailable.body, /Fresh BTC price unavailable/);
  assert.equal(context.state.submissions, 2);
  assert.equal(context.state.player?.pendingGuessId, undefined);
});
