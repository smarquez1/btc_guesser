import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Player } from '../types/player.ts';

export function playerRepository(client: DynamoDBDocumentClient, tableName: string) {
  return {
    async get(id: string): Promise<Player | undefined> {
      const { Item } = await client.send(new GetCommand({
        TableName: tableName,
        Key: { pk: `PLAYER#${id}`, sk: 'PROFILE' },
        ConsistentRead: true,
      }));

      if (!Item) return undefined;

      return {
        id: Item.id,
        name: Item.name,
        score: Item.score,
        createdAt: Item.createdAt,
        ...(Item.pendingGuessId ? { pendingGuessId: Item.pendingGuessId } : {}),
      };
    },

    async create(player: Player) {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: { pk: `PLAYER#${player.id}`, sk: 'PROFILE', ...player },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
    },

    async consumeCreationAttempt(addressHash: string, now: number) {
      const windowStart = Math.floor(now / 3600) * 3600;

      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: `PLAYER_LIMIT#${addressHash}`, sk: `${windowStart}` },
          UpdateExpression: 'SET expiresAt = :expiry ADD attempts :one',
          ConditionExpression: 'attribute_not_exists(attempts) OR attempts < :limit',
          ExpressionAttributeValues: {
            ':expiry': windowStart + 7200,
            ':one': 1,
            ':limit': 10,
          },
        }));

        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return false;

        throw error;
      }
    },
  };
}
