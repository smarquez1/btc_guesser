import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CachedPrice } from '../types/price.ts';

export function priceRepository(client: DynamoDBDocumentClient, tableName: string) {
  const key = { pk: 'PRICE#BTC-USD', sk: 'LATEST' };

  async function get(): Promise<CachedPrice | undefined> {
    const { Item } = await client.send(new GetCommand({
      TableName: tableName,
      Key: key,
      ConsistentRead: true,
    }));

    if (!Item) return undefined;

    return {
      symbol: 'BTC-USD',
      tradeId: Item.tradeId,
      price: Item.price,
      observedAt: Item.observedAt,
      freshUntil: Item.freshUntil,
      expiresAt: Item.expiresAt,
    };
  }

  return {
    get,

    async save(observation: CachedPrice): Promise<CachedPrice | undefined> {
      try {
        await client.send(new PutCommand({
          TableName: tableName,
          Item: { ...key, ...observation },
          // Equal trades may refresh freshness; older trades never replace newer ones.
          // Timestamp comparison permits upgrading cache entries without a trade ID.
          ConditionExpression:
            'attribute_not_exists(pk) OR ' +
            '(attribute_not_exists(tradeId) AND observedAt <= :observedAt) OR ' +
            'tradeId < :tradeId OR ' +
            '(tradeId = :tradeId AND freshUntil < :freshUntil)',
          ExpressionAttributeValues: {
            ':tradeId': observation.tradeId,
            ':observedAt': observation.observedAt,
            ':freshUntil': observation.freshUntil,
          },
        }));

        return observation;
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;

        // Another request already stored a newer trade or a later refresh.
        return get();
      }
    },
  };
}
