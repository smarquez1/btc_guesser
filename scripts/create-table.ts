import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { loadConfig } from '../server/config.ts';
import { createDynamoDB } from '../server/lib/dynamodb.ts';

async function main() {
  const config = loadConfig();
  if (!config.dynamodbEndpoint) {
    throw new Error(
      'db:create is for local setup; set DYNAMODB_ENDPOINT explicitly',
    );
  }
  const { client } = createDynamoDB(config);
  const TableName = config.tableName;
  try {
    try {
      await client.send(new DescribeTableCommand({ TableName }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
      await client.send(
        new CreateTableCommand({
          TableName,
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
      console.log(`Created ${TableName}`);
    }
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName });
    const table = (await client.send(new DescribeTableCommand({ TableName })))
      .Table;
    const keys = table?.KeySchema ?? [];
    const attributes = table?.AttributeDefinitions ?? [];
    if (
      keys.length !== 2 ||
      !keys.some(
        (key) => key.AttributeName === 'pk' && key.KeyType === 'HASH',
      ) ||
      !keys.some(
        (key) => key.AttributeName === 'sk' && key.KeyType === 'RANGE',
      ) ||
      !['pk', 'sk'].every((name) =>
        attributes.some(
          (attr) => attr.AttributeName === name && attr.AttributeType === 'S',
        ),
      )
    ) {
      throw new Error(
        `Table ${TableName} must have string keys pk (HASH) and sk (RANGE)`,
      );
    }
    const ttl = (
      await client.send(new DescribeTimeToLiveCommand({ TableName }))
    ).TimeToLiveDescription;
    if (ttl?.TimeToLiveStatus === 'DISABLED') {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName,
          TimeToLiveSpecification: {
            AttributeName: 'expiresAt',
            Enabled: true,
          },
        }),
      );
    } else if (
      !['ENABLED', 'ENABLING'].includes(ttl?.TimeToLiveStatus ?? '') ||
      ttl?.AttributeName !== 'expiresAt'
    ) {
      throw new Error(
        `Table ${TableName} must use expiresAt for TTL; current TTL configuration is incompatible`,
      );
    }
    console.log(
      `${TableName} ready: string pk/sk keys, expiresAt TTL enabled or enabling`,
    );
  } finally {
    client.destroy();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Table setup failed');
  process.exitCode = 1;
}
