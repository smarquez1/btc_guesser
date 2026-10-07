import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import { buildApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { playerRoutes } from '../server/routes/players.ts';

const player = {
  id: '6e6680df-e78f-4c44-b1d4-45d27218b82d',
  name: 'Player', score: -2, createdAt: 1800000000,
  pendingGuessId: 'pending-guess',
};
const config = loadConfig({
  AWS_REGION: 'us-east-1', DYNAMODB_TABLE: 'test-table',
  APP_ORIGIN: 'https://game.example', COOKIE_SECURE: 'true',
});

function setup() {
  const app = buildApp();
  const players = {
    find: async (identity: string | undefined) => identity === player.id ? player : undefined,
    create: async (_address: string): Promise<typeof player | undefined> => player,
  };
  app.register(cookie);
  app.register(playerRoutes, { config, players });

  return { app, players };
}

test('creation sets a secure opaque cookie and excludes identity from JSON', async (t) => {
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async (address) => {
    assert.equal(address, '127.0.0.2');

    return player;
  };
  const response = await app.inject({
    method: 'POST', url: '/api/players', remoteAddress: '127.0.0.2',
    headers: { origin: config.appOrigin }, payload: {},
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), {
    name: player.name, score: player.score, createdAt: player.createdAt,
    pendingGuessId: player.pendingGuessId,
  });
  const header = String(response.headers['set-cookie']);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api', 'Max-Age=31536000']) {
    assert.ok(header.includes(flag));
  }
  assert.ok(header.startsWith(`btc_player=${player.id};`));
});

test('returning players reuse persisted state without consuming creation attempts', async (t) => {
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async () => { throw new Error('unexpected creation'); };

  for (const method of ['POST', 'GET'] as const) {
    const response = await app.inject({
      method, url: method === 'POST' ? '/api/players' : '/api/players/me',
      headers: { cookie: `btc_player=${player.id}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().score, -2);
    assert.equal(response.json().id, undefined);
  }
});

test('invalid cookies are rejected and cleared without creating replacement players', async (t) => {
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async () => { throw new Error('unexpected creation'); };

  for (const method of ['POST', 'GET'] as const) {
    const response = await app.inject({
      method, url: method === 'POST' ? '/api/players' : '/api/players/me',
      headers: { cookie: 'btc_player=invalid' },
    });

    assert.equal(response.statusCode, 401);
    assert.match(String(response.headers['set-cookie']), /Max-Age=0/);
  }
  assert.equal((await app.inject('/api/players/me')).statusCode, 401);
});

test('creation rejects client state and cross-site requests before storage', async (t) => {
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async () => { throw new Error('unexpected creation'); };

  for (const payload of [{ score: 100 }, { id: player.id }, [], 'text']) {
    const response = await app.inject({
      method: 'POST', url: '/api/players',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });

    assert.equal(response.statusCode, 400);
  }
  for (const headers of [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/players', headers });

    assert.equal(response.statusCode, 403);
  }
});

test('throttling returns a retry time and no identity cookie', async (t) => {
  t.mock.method(Date, 'now', () => 1800000000000);
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async () => undefined;
  const response = await app.inject({ method: 'POST', url: '/api/players' });

  assert.equal(response.statusCode, 429);
  assert.equal(Number(response.headers['retry-after']), 3600);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('player database errors return safe 500 responses', async (t) => {
  const { app, players } = setup();
  t.after(() => app.close());
  players.create = async () => { throw new Error('private database details'); };
  players.find = async () => { throw new Error('private database details'); };

  for (const method of ['POST', 'GET'] as const) {
    const response = await app.inject({
      method, url: method === 'POST' ? '/api/players' : '/api/players/me',
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal server error' });
    assert.equal(response.headers['set-cookie'], undefined);
  }
});
