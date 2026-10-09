import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { loadConfig } from '../../server/config.ts';
import { createDynamoDB } from '../../server/lib/dynamodb.ts';

export async function createLocalDatabase(overrides: NodeJS.ProcessEnv = {}) {
  const endpoint = process.env.DYNAMODB_ENDPOINT;

  if (!endpoint || new URL(endpoint).protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)) {
    throw new Error('Set DYNAMODB_ENDPOINT to a local DynamoDB HTTP endpoint');
  }

  // The SDK reads credentials from the environment, independently of Config.
  process.env.AWS_ACCESS_KEY_ID = 'local';
  process.env.AWS_SECRET_ACCESS_KEY = 'local';
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_PROFILE;

  const environment = {
    ...process.env,
    AWS_REGION: 'us-east-1',
    APP_ORIGIN: 'http://127.0.0.1',
    HOST: '127.0.0.1',
    PORT: '3000',
    COOKIE_SECURE: 'false',
    ...overrides,
    DYNAMODB_TABLE: `btc-guess-test-${randomUUID()}`,
    DYNAMODB_ENDPOINT: endpoint,
  };
  const config = loadConfig(environment);
  const database = createDynamoDB(config);

  try {
    await database.client.send(new CreateTableCommand({
      TableName: config.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
    }));
  } catch (error) {
    database.client.destroy();
    throw error;
  }

  async function close() {
    try {
      await database.client.send(new DeleteTableCommand({ TableName: config.tableName }));
    } finally {
      database.client.destroy();
    }
  }

  return { ...database, config, environment, close };
}
