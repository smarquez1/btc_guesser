import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTimeToLiveCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { priceRepository } from '../../server/repositories/prices.ts';
import { guessRepository } from '../../server/repositories/guesses.ts';
import { priceService } from '../../server/services/prices.ts';
import { priceRoutes } from '../../server/routes/prices.ts';
import type { CachedPrice } from '../../server/types/price.ts';
import { buildApp } from '../../server/app.ts';
import { playerRepository } from '../../server/repositories/players.ts';
import { loadConfig } from '../../server/config.ts';
import { createDynamoDB } from '../../server/lib/dynamodb.ts';

const endpoint = process.env.DYNAMODB_ENDPOINT;
if (
  !endpoint ||
  new URL(endpoint).protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)
) {
  throw new Error(
    'Set DYNAMODB_ENDPOINT to a local DynamoDB HTTP endpoint',
  );
}

// The SDK reads credentials from process.env, not the app configuration.
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;

const execute = promisify(execFile);
const environment = {
  ...process.env,
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
  AWS_SESSION_TOKEN: '',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  DYNAMODB_ENDPOINT: endpoint,
  PORT: '3000',
  HOST: '127.0.0.1',
  COOKIE_SECURE: 'false',
};

function setupTable(tableName: string) {
  return execute(
    process.execPath,
    ['--import', 'tsx', 'scripts/create-table.ts'],
    {
      env: { ...environment, DYNAMODB_TABLE: tableName },
      timeout: 30000,
    },
  );
}

// Every test owns one unique table; application data is never used.
test('table setup creates keys and TTL, reruns safely, and supports document I/O', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const { client, documentClient } = createDynamoDB(
    loadConfig({ ...environment, DYNAMODB_TABLE: tableName }),
  );
  t.after(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    } finally {
      client.destroy();
    }
  });

  await setupTable(tableName);
  await setupTable(tableName);

  const { Table } = await client.send(
    new DescribeTableCommand({ TableName: tableName }),
  );
  assert.deepEqual(Table?.KeySchema, [
    { AttributeName: 'pk', KeyType: 'HASH' },
    { AttributeName: 'sk', KeyType: 'RANGE' },
  ]);
  assert.ok(
    Table?.AttributeDefinitions?.every(
      (attribute) => attribute.AttributeType === 'S',
    ),
  );

  const { TimeToLiveDescription } = await client.send(
    new DescribeTimeToLiveCommand({ TableName: tableName }),
  );
  assert.equal(TimeToLiveDescription?.AttributeName, 'expiresAt');
  assert.equal(TimeToLiveDescription?.TimeToLiveStatus, 'ENABLED');

  const item = {
    pk: 'PRICE#BTC-USD',
    sk: 'LATEST',
    price: 60000,
    observedAt: 1800000000,
    freshUntil: 1800000005,
    expiresAt: 1800003600,
  };
  await documentClient.send(
    new PutCommand({ TableName: tableName, Item: item }),
  );

  const result = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: item.pk, sk: item.sk },
      ConsistentRead: true,
    }),
  );
  assert.deepEqual(result.Item, item);
});

test('table setup rejects existing incompatible keys', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const { client } = createDynamoDB(
    loadConfig({ ...environment, DYNAMODB_TABLE: tableName }),
  );
  t.after(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    } finally {
      client.destroy();
    }
  });

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    }),
  );

  await assert.rejects(
    setupTable(tableName),
    /must have string keys pk \(HASH\) and sk \(RANGE\)/,
  );
});

test('table setup rejects existing incompatible TTL without changing it', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const { client } = createDynamoDB(
    loadConfig({ ...environment, DYNAMODB_TABLE: tableName }),
  );
  t.after(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    } finally {
      client.destroy();
    }
  });

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    }),
  );
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'wrongExpiry', Enabled: true },
    }),
  );

  await assert.rejects(setupTable(tableName), /must use expiresAt for TTL/);

  const { TimeToLiveDescription } = await client.send(
    new DescribeTimeToLiveCommand({ TableName: tableName }),
  );
  assert.equal(TimeToLiveDescription?.AttributeName, 'wrongExpiry');
});

test('player API persists identities across app instances and rejects duplicate profile writes', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const config = loadConfig({ ...environment, DYNAMODB_TABLE: tableName });
  const { client, documentClient } = createDynamoDB(config);
  const firstApp = buildApp(config);
  const secondApp = buildApp(config);
  t.after(async () => {
    await Promise.all([firstApp.close(), secondApp.close()]);

    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await setupTable(tableName);
  const repository = playerRepository(documentClient, tableName);
  const created = await firstApp.inject({ method: 'POST', url: '/api/players' });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json().score, 0);
  const identityCookie = String(created.headers['set-cookie']).split(';')[0];
  const id = identityCookie.split('=')[1];
  const stored = await documentClient.send(new GetCommand({
    TableName: tableName, Key: { pk: `PLAYER#${id}`, sk: 'PROFILE' },
    ConsistentRead: true,
  }));

  assert.equal(stored.Item?.score, 0);
  assert.equal(stored.Item?.expiresAt, undefined);
  assert.ok(Number.isInteger(stored.Item?.createdAt));
  assert.deepEqual(await repository.get(id), {
    id, name: created.json().name, score: 0, createdAt: created.json().createdAt,
  });
  await assert.rejects(repository.create({
    id, name: 'Overwrite', score: 99, createdAt: 1,
  }), { name: 'ConditionalCheckFailedException' });

  const resumed = await secondApp.inject({
    method: 'POST', url: '/api/players', headers: { cookie: identityCookie },
  });
  assert.equal(resumed.statusCode, 200);
  assert.deepEqual(resumed.json(), created.json());

  // Simulate later game state and verify the API reads storage, not cookie state.
  await documentClient.send(new UpdateCommand({
    TableName: tableName, Key: { pk: `PLAYER#${id}`, sk: 'PROFILE' },
    UpdateExpression: 'SET score = :score, pendingGuessId = :guess',
    ExpressionAttributeValues: { ':score': -4, ':guess': 'guess-123' },
  }));
  const profile = await secondApp.inject({
    url: '/api/players/me', headers: { cookie: identityCookie },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().score, -4);
  assert.equal(profile.json().pendingGuessId, 'guess-123');
  assert.equal(profile.json().id, undefined);

  const unknown = await secondApp.inject({
    url: '/api/players/me', headers: { cookie: `btc_player=${randomUUID()}` },
  });
  assert.equal(unknown.statusCode, 401);
});

test('concurrent player creation succeeds across app instances', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const config = loadConfig({ ...environment, DYNAMODB_TABLE: tableName });
  const { client } = createDynamoDB(config);
  const apps = [buildApp(config), buildApp(config)];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));

    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await setupTable(tableName);
  const responses = await Promise.all(Array.from({ length: 16 }, (_, index) =>
    apps[index % 2].inject({
      method: 'POST', url: '/api/players', remoteAddress: '127.0.0.2',
      headers: { 'x-forwarded-for': `192.0.2.${index}` },
    }),
  ));

  assert.equal(responses.filter((response) => response.statusCode === 201).length, 16);
  assert.equal(new Set(responses.map((response) => response.headers['set-cookie'])).size, 16);
  const otherAddress = await apps[0].inject({
    method: 'POST', url: '/api/players', remoteAddress: '127.0.0.3',
  });
  assert.equal(otherAddress.statusCode, 201);
});


test('price cache writes never replace newer observations, including concurrent requests', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const { client, documentClient } = createDynamoDB(
    loadConfig({ ...environment, DYNAMODB_TABLE: tableName }),
  );
  t.after(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await setupTable(tableName);
  const repository = priceRepository(documentClient, tableName);
  const base: CachedPrice = {
    symbol: 'BTC-USD', tradeId: 20, price: 65000, observedAt: 1800000000,
    freshUntil: 1800000005, expiresAt: 1800003600,
  };

  assert.equal(await repository.get(), undefined);
  await Promise.all(Array.from({ length: 12 }, (_, index) => repository.save({
    ...base, tradeId: base.tradeId + index, price: base.price + index,
  })));
  const latest = { ...base, tradeId: 31, price: 65011 };

  assert.deepEqual(await repository.get(), latest);
  assert.deepEqual(await repository.save(base), latest);
  // An older trade with a later fetch time must still lose.
  assert.deepEqual(await repository.save({ ...base, freshUntil: base.freshUntil + 50 }), latest);
  const refreshed = { ...latest, freshUntil: latest.freshUntil + 5 };

  assert.deepEqual(await repository.save(refreshed), refreshed);
  assert.deepEqual(await repository.save(latest), refreshed);
  assert.deepEqual(await repository.get(), refreshed);

  // Upgrade existing cache records without allowing source time to regress.
  const { tradeId: _tradeId, ...legacy } = base;
  await documentClient.send(new PutCommand({
    TableName: tableName, Item: { pk: 'PRICE#BTC-USD', sk: 'LATEST', ...legacy },
  }));
  await repository.save({ ...base, observedAt: base.observedAt - 1 });
  assert.equal((await repository.get())?.tradeId, undefined);
  assert.equal((await repository.get())?.observedAt, base.observedAt);
  await repository.save(base);
  assert.deepEqual(await repository.get(), base);
});

test('price service shares persisted cache and rejects expiry before DynamoDB TTL cleanup', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const { client, documentClient } = createDynamoDB(
    loadConfig({ ...environment, DYNAMODB_TABLE: tableName }),
  );
  const app = buildApp();
  t.after(async () => {
    await app.close();

    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await setupTable(tableName);
  let now = 1800000000;
  t.mock.method(Date, 'now', () => now * 1000);
  const repository = priceRepository(documentClient, tableName);
  const first = priceService(repository, async () => ({ tradeId: 20, price: 65000, observedAt: now }));
  const second = priceService(priceRepository(documentClient, tableName), async () => {
    throw new Error('Coinbase unavailable');
  });
  const initial = await first.get();

  assert.deepEqual(await second.get(), initial);
  now += 5;
  app.register(priceRoutes, { prices: second });
  const stale = await app.inject('/api/price');

  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().observedAt, 1800000000);
  now = 1800003600;
  const expired = await app.inject('/api/price');

  assert.equal(expired.statusCode, 503);
  assert.deepEqual(await repository.get(), {
    symbol: 'BTC-USD', tradeId: 20, price: 65000, observedAt: 1800000000,
    freshUntil: 1800000005, expiresAt: 1800003600,
  });
});

test('guess API transactions enforce one pending guess and exactly-once scoring across app instances', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const config = loadConfig({ ...environment, DYNAMODB_TABLE: tableName });
  const { client, documentClient } = createDynamoDB(config);
  const apps = [buildApp(config), buildApp(config)];
  t.after(async () => {
    await Promise.all(apps.map(app => app.close()));

    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  });
  await setupTable(tableName);
  let clock = 1800000000;
  t.mock.method(Date, 'now', () => clock * 1000);
  const players = playerRepository(documentClient, tableName);
  const guesses = guessRepository(documentClient, tableName);
  const prices = priceRepository(documentClient, tableName);
  const orphan = {
    id: randomUUID(), playerId: randomUUID(), direction: 'up' as const,
    status: 'pending' as const, startingPrice: 100, startingObservedAt: clock,
    startedAt: clock, deadline: clock + 60,
  };

  assert.equal(await guesses.create(orphan), false);
  assert.equal(await guesses.get(orphan.id), undefined);
  const playerId = randomUUID();
  const otherId = randomUUID();
  await players.create({ id: playerId, name: 'Player', score: 0, createdAt: clock });
  await players.create({ id: otherId, name: 'Other', score: 0, createdAt: clock });
  await prices.save({ symbol: 'BTC-USD', tradeId: 1, price: 100,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  const headers = { cookie: `btc_player=${playerId}` };
  const submitted = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    apps[index % 2].inject({ method: 'POST', url: '/api/guesses', headers, payload: { direction: 'up' } }),
  ));

  assert.equal(submitted.filter(response => response.statusCode === 201).length, 1);
  assert.equal(submitted.filter(response => response.statusCode === 409).length, 7);
  const initial = submitted.find(response => response.statusCode === 201)?.json();

  assert.ok(initial);
  assert.equal(initial.startedAt, clock);
  assert.equal(initial.deadline, clock + 60);
  assert.equal((await players.get(playerId))?.pendingGuessId, initial.id);
  assert.equal((await guesses.get(initial.id))?.expiresAt, undefined);
  const read = (index = 0) => apps[index % 2].inject({ url: `/api/guesses/${initial.id}`, headers });
  const foreign = await apps[1].inject({ url: `/api/guesses/${initial.id}`,
    headers: { cookie: `btc_player=${otherId}` } });

  assert.equal(foreign.statusCode, 404);
  clock = initial.deadline - 1;
  assert.equal((await read()).json().status, 'pending');
  clock = initial.deadline;
  await prices.save({ symbol: 'BTC-USD', tradeId: 2, price: 101,
    observedAt: clock - 1, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  assert.equal((await read()).json().status, 'pending');
  await prices.save({ symbol: 'BTC-USD', tradeId: 3, price: 100,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  assert.equal((await read()).json().status, 'pending');
  assert.equal((await players.get(playerId))?.score, 0);
  await prices.save({ symbol: 'BTC-USD', tradeId: 4, price: 101,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  const resolved = await Promise.all(Array.from({ length: 8 }, (_, index) => read(index)));

  for (const response of resolved) {
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ...initial, status: 'resolved', finalPrice: 101, finalObservedAt: clock,
      resolvedAt: clock, correct: true, scoreDelta: 1,
    });
  }
  assert.equal((await players.get(playerId))?.score, 1);
  assert.equal((await players.get(playerId))?.pendingGuessId, undefined);
  await read();
  assert.equal((await players.get(playerId))?.score, 1);
  const next = await apps[1].inject({ method: 'POST', url: '/api/guesses', headers, payload: { direction: 'down' } });

  assert.equal(next.statusCode, 201);
  clock += 60;
  await prices.save({ symbol: 'BTC-USD', tradeId: 5, price: 102,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  const lost = await apps[0].inject({ url: `/api/guesses/${next.json().id}`, headers });

  assert.equal(lost.statusCode, 200);
  assert.equal(lost.json().scoreDelta, -1);
  assert.equal((await players.get(playerId))?.score, 0);
  assert.equal((await players.get(playerId))?.pendingGuessId, undefined);
  const stored = await guesses.get(initial.id);

  assert.ok(stored?.expiresAt);
  assert.equal(await guesses.resolve({ ...stored, scoreDelta: 99 }), false);
  assert.deepEqual(await guesses.get(initial.id), stored);
  assert.equal((await players.get(playerId))?.score, 0);
  clock = stored.expiresAt;
  assert.equal((await read()).statusCode, 404);
  assert.ok(await guesses.get(initial.id));
  assert.equal((await players.get(playerId))?.score, 0);
});
