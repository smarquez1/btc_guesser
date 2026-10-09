import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildApp } from '../../server/app.ts';
import { guessRepository } from '../../server/repositories/guesses.ts';
import { playerRepository } from '../../server/repositories/players.ts';
import { priceRepository } from '../../server/repositories/prices.ts';
import { resolveGuess } from '../../server/services/guesses.ts';
import type { PriceObservation } from '../../server/types/price.ts';
import { createLocalDatabase } from '../helpers/localDatabase.ts';

async function setupGame(t: TestContext) {
  const database = await createLocalDatabase();
  let now = 1_800_000_000;
  let upstream: PriceObservation | undefined = { tradeId: 1, price: 60_000, observedAt: now };
  t.mock.method(Date, 'now', () => now * 1000);
  const app = buildApp(database.config, async () => {
    if (!upstream) {
      throw new Error('Controlled Coinbase outage');
    }

    return upstream;
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await database.close();
    }
  });
  const created = await app.inject({ method: 'POST', url: '/api/players' });
  assert.equal(created.statusCode, 201);
  const cookie = String(created.headers['set-cookie']).split(';')[0];
  const playerId = cookie.split('=')[1];
  const headers = { cookie };
  const guesses = guessRepository(database.documentClient, database.config.tableName);
  const players = playerRepository(database.documentClient, database.config.tableName);
  const prices = priceRepository(database.documentClient, database.config.tableName);

  async function submit() {
    return app.inject({ method: 'POST', url: '/api/guesses', headers, payload: { direction: 'up' } });
  }

  async function read(id: string) {
    return app.inject({ url: `/api/guesses/${id}`, headers });
  }

  return {
    ...database, app, guesses, players, prices, playerId, submit, read,
    setTime(value: number) { now = value; },
    setUpstream(value: PriceObservation | undefined) { upstream = value; },
  };
}

test('a failed profile condition rolls back the entire resolution transaction', async t => {
  const game = await setupGame(t);
  const response = await game.submit();
  assert.equal(response.statusCode, 201);
  const pending = await game.guesses.get(response.json().id);
  assert.ok(pending);
  const replacementId = randomUUID();
  await game.documentClient.send(new UpdateCommand({
    TableName: game.config.tableName,
    Key: { pk: `PLAYER#${game.playerId}`, sk: 'PROFILE' },
    UpdateExpression: 'SET pendingGuessId = :replacement',
    ExpressionAttributeValues: { ':replacement': replacementId },
  }));
  const profileBefore = await game.players.get(game.playerId);
  const resolved = resolveGuess(pending, {
    symbol: 'BTC-USD', price: 60_100, observedAt: pending.deadline, stale: false,
  }, pending.deadline);
  assert.equal(resolved.status, 'resolved');

  assert.equal(await game.guesses.resolve(resolved), false);
  assert.deepEqual(await game.guesses.get(pending.id), pending);
  assert.deepEqual(await game.players.get(game.playerId), profileBefore);
  assert.equal((await game.players.get(game.playerId))?.score, 0);
});

test('stored stale pricing blocks submission but eligible stale evidence resolves an existing guess', async t => {
  const game = await setupGame(t);
  const response = await game.submit();
  assert.equal(response.statusCode, 201);
  const guess = response.json();
  game.setUpstream(undefined);
  game.setTime(guess.deadline + 10);
  await game.prices.save({
    symbol: 'BTC-USD', tradeId: 2, price: 60_100, observedAt: guess.deadline,
    freshUntil: guess.deadline + 5, expiresAt: guess.deadline + 3600,
  });

  const result = await game.read(guess.id);
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().status, 'resolved');
  assert.equal(result.json().finalObservedAt, guess.deadline);
  assert.equal((await game.players.get(game.playerId))?.score, 1);
  const blocked = await game.submit();
  assert.equal(blocked.statusCode, 503);
  assert.equal((await game.players.get(game.playerId))?.pendingGuessId, undefined);

  game.setUpstream({ tradeId: 3, price: 60_200, observedAt: guess.deadline + 10 });
  const recovered = await game.submit();
  assert.equal(recovered.statusCode, 201);
  assert.equal(recovered.json().startingPrice, 60_200);
});

test('expired pricing during an outage preserves a pending guess until a fresh observation arrives', async t => {
  const game = await setupGame(t);
  const response = await game.submit();
  assert.equal(response.statusCode, 201);
  const guess = response.json();
  const pendingBefore = await game.guesses.get(guess.id);
  game.setUpstream(undefined);
  const recoveredAt = guess.startedAt + 3600;
  game.setTime(recoveredAt);

  const unavailable = await game.app.inject('/api/price');
  assert.equal(unavailable.statusCode, 503);
  const pending = await game.read(guess.id);
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().status, 'pending');
  assert.deepEqual(await game.guesses.get(guess.id), pendingBefore);
  assert.equal((await game.players.get(game.playerId))?.score, 0);
  assert.equal((await game.players.get(game.playerId))?.pendingGuessId, guess.id);
  assert.ok(await game.prices.get(), 'expired record still exists before TTL cleanup');

  game.setUpstream({ tradeId: 2, price: 60_100, observedAt: recoveredAt });
  const result = await game.read(guess.id);
  assert.equal(result.json().status, 'resolved');
  assert.equal(result.json().finalObservedAt, recoveredAt);
  assert.equal((await game.players.get(game.playerId))?.score, 1);
  assert.equal((await game.players.get(game.playerId))?.pendingGuessId, undefined);
  await game.read(guess.id);
  assert.equal((await game.players.get(game.playerId))?.score, 1);
});
