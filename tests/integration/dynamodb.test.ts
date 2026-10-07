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
