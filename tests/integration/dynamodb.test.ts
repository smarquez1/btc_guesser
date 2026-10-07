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
import { buildApp } from '../../server/app.ts';
import { playerRepository } from '../../server/repositories/players.ts';
import { loadConfig } from '../../server/config.ts';
import { createDynamoDB } from '../../server/lib/dynamodb.ts';

const endpoint = process.env.TEST_DYNAMODB_ENDPOINT;
if (
  !endpoint ||
  new URL(endpoint).protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)
) {
  throw new Error(
    'Set TEST_DYNAMODB_ENDPOINT to a local DynamoDB HTTP endpoint',
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

test('creation limit is atomic across app instances and ignores old counters before TTL deletion', async (t) => {
  const tableName = `btc-guess-test-${randomUUID()}`;
  const config = loadConfig({ ...environment, DYNAMODB_TABLE: tableName });
  const { client, documentClient } = createDynamoDB(config);
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

  assert.equal(responses.filter((response) => response.statusCode === 201).length, 10);
  assert.equal(responses.filter((response) => response.statusCode === 429).length, 6);
  const otherAddress = await apps[0].inject({
    method: 'POST', url: '/api/players', remoteAddress: '127.0.0.3',
  });
  assert.equal(otherAddress.statusCode, 201);

  const repository = playerRepository(documentClient, tableName);
  const windowStart = 1800000000;
  const hash = 'window-boundary-check';
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal(await repository.consumeCreationAttempt(hash, windowStart), true);
  }
  assert.equal(await repository.consumeCreationAttempt(hash, windowStart + 3599), false);
  assert.equal(await repository.consumeCreationAttempt(hash, windowStart + 3600), true);
  assert.equal(await repository.consumeCreationAttempt(hash, windowStart + 7200), true);
  const oldCounter = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: { pk: `PLAYER_LIMIT#${hash}`, sk: String(windowStart) },
    ConsistentRead: true,
  }));

  assert.equal(oldCounter.Item?.attempts, 10);
  assert.equal(oldCounter.Item?.expiresAt, windowStart + 7200);
  assert.ok(Number.isInteger(oldCounter.Item?.expiresAt));
});
