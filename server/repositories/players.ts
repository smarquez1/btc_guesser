import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
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
  };
}
