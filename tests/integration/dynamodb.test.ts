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
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { priceRepository } from '../../server/repositories/prices.ts';
import { guessRepository } from '../../server/repositories/guesses.ts';
import { priceService } from '../../server/services/prices.ts';
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
  t.after(async () => {
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
  const stale = await second.get();

  assert.equal(stale?.stale, true);
  assert.equal(stale?.observedAt, 1800000000);
  now = 1800003600;
  const expired = await second.get();

  assert.equal(expired, undefined);
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
  const headers = {
    cookie: `btc_player=${playerId}`,
    origin: config.appOrigin,
    'content-type': 'application/x-www-form-urlencoded',
  };
  const submitted = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    apps[index % 2].inject({ method: 'POST', url: '/api/ui/guesses', headers, payload: 'direction=up' }),
  ));

  assert.equal(submitted.filter(response => response.statusCode === 200).length, 8);
  assert.equal(submitted.filter(response => response.body.includes('Your guess:')).length, 8);
  const initialId = (await players.get(playerId))?.pendingGuessId;

  assert.ok(initialId);
  const initial = await guesses.get(initialId);
  assert.ok(initial);
  assert.equal(initial.startedAt, clock);
  assert.equal(initial.deadline, clock + 60);
  assert.equal(initial.expiresAt, undefined);
  const read = (index = 0) => apps[index % 2].inject({
    url: `/api/ui/game?guessId=${initialId}`, headers: { cookie: `btc_player=${playerId}` },
  });
  const foreign = await apps[1].inject({
    url: `/api/ui/game?guessId=${initialId}`, headers: { cookie: `btc_player=${otherId}` },
  });

  assert.equal(foreign.statusCode, 200);
  assert.doesNotMatch(foreign.body, /Your guess:/);
  clock = initial.deadline - 1;
  assert.match((await read()).body, /Your guess:/);
  clock = initial.deadline;
  await prices.save({ symbol: 'BTC-USD', tradeId: 2, price: 101,
    observedAt: clock - 1, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  assert.match((await read()).body, /Your guess:/);
  await prices.save({ symbol: 'BTC-USD', tradeId: 3, price: 100,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  assert.match((await read()).body, /Your guess:/);
  assert.equal((await players.get(playerId))?.score, 0);
  await prices.save({ symbol: 'BTC-USD', tradeId: 4, price: 101,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  const resolved = await Promise.all(Array.from({ length: 8 }, (_, index) => read(index)));

  for (const response of resolved) {
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Correct! \+1 point/);
    assert.match(response.body, /\$101\.00/);
  }
  assert.equal((await players.get(playerId))?.score, 1);
  assert.equal((await players.get(playerId))?.pendingGuessId, undefined);
  await read();
  assert.equal((await players.get(playerId))?.score, 1);
  await apps[1].inject({ method: 'POST', url: '/api/ui/guesses', headers, payload: 'direction=down' });
  const nextId = (await players.get(playerId))?.pendingGuessId;
  assert.ok(nextId);
  clock += 60;
  await prices.save({ symbol: 'BTC-USD', tradeId: 5, price: 102,
    observedAt: clock, freshUntil: clock + 1000, expiresAt: clock + 3600 });
  const lost = await apps[0].inject({
    url: `/api/ui/game?guessId=${nextId}`, headers: { cookie: `btc_player=${playerId}` },
  });

  assert.equal(lost.statusCode, 200);
  assert.match(lost.body, /Incorrect\. −1 point/);
  assert.equal((await players.get(playerId))?.score, 0);
  assert.equal((await players.get(playerId))?.pendingGuessId, undefined);
  const stored = await guesses.get(initial.id);

  assert.ok(stored?.expiresAt);
  assert.equal(await guesses.resolve({ ...stored, scoreDelta: 99 }), false);
  assert.deepEqual(await guesses.get(initial.id), stored);
  assert.equal((await players.get(playerId))?.score, 0);
  clock = stored.expiresAt;
  assert.equal((await read()).statusCode, 200);
  assert.ok(await guesses.get(initial.id));
  assert.equal((await players.get(playerId))?.score, 0);
});
