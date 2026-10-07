import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Config } from '../config.ts';

export function createDynamoDB(config: Config) {
  const client = new DynamoDBClient({
    region: config.region,
    endpoint: config.dynamodbEndpoint,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
  const documentClient = DynamoDBDocumentClient.from(client);

  return { client, documentClient };
}
