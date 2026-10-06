import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ActiveGuessConflict,
  type PendingGuess,
  type PlayerRecord,
  type PlayerStore,
} from "./players.js";

export function createDynamoClient(endpoint = process.env.DYNAMODB_ENDPOINT) {
  if (endpoint) {
    const url = new URL(endpoint);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error(
        "DYNAMODB_ENDPOINT must be loopback (local development only)",
      );
  }
  return new DynamoDBClient({
    ...(endpoint
      ? {
          endpoint,
          region: process.env.AWS_REGION ?? "us-east-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {}),
    maxAttempts: 2,
  });
}
export class DynamoPlayerStore implements PlayerStore {
  constructor(
    private readonly client: Pick<DynamoDBDocumentClient, "send">,
    private readonly table: string,
  ) {}
  async create(player: PlayerRecord) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: player,
        ConditionExpression: "attribute_not_exists(playerId)",
      }),
    );
  }
  async get(playerId: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { playerId },
        ConsistentRead: true,
      }),
    );
    return result.Item as PlayerRecord | undefined;
  }
  async accept(playerId: string, guess: PendingGuess) {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { playerId },
          UpdateExpression: "SET activeGuess = :guess",
          ConditionExpression:
            "attribute_exists(playerId) AND attribute_not_exists(activeGuess)",
          ExpressionAttributeValues: { ":guess": guess },
          ReturnValues: "ALL_NEW",
        }),
      );
      if (!result.Attributes)
        throw new Error("DynamoDB update returned no player");
      return result.Attributes as PlayerRecord;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        // A deleted player is not an active-guess conflict.
        if (!(await this.get(playerId)))
          throw new Error("Player no longer exists");
        throw new ActiveGuessConflict();
      }
      throw error;
    }
  }
}
export function runtimePersistence() {
  const table = process.env.DYNAMODB_TABLE?.trim();
  if (!table) return undefined;
  const client = createDynamoClient();
  return {
    store: new DynamoPlayerStore(DynamoDBDocumentClient.from(client), table),
    close: () => client.destroy(),
  };
}
