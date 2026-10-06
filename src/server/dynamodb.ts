import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  type ScanCommandOutput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ActiveGuessConflict,
  ObsoleteGuessConflict,
  type PendingGuess,
  type PlayerRecord,
  type PlayerStore,
  type ResolvedGuess,
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
  // One Scan page per due() call; the cursor carries the sweep across ticks.
  private cursor?: NonNullable<ScanCommandOutput["LastEvaluatedKey"]>;
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
  async resolve(playerId: string, guess: ResolvedGuess) {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { playerId },
          // The condition pins the exact guess identity, so overlapping workers or
          // retries cannot score twice or resolve a replacement; score change,
          // active-clearing, and latest-result commit in one atomic write.
          UpdateExpression:
            "SET latestGuess = :guess REMOVE activeGuess ADD score :delta",
          ConditionExpression:
            "attribute_exists(playerId) AND #active.#id = :guessId",
          ExpressionAttributeNames: { "#active": "activeGuess", "#id": "id" },
          ExpressionAttributeValues: {
            ":guess": guess,
            ":delta": guess.scoreDelta,
            ":guessId": guess.id,
          },
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
        // Already resolved, replaced, or a missing player is expected, not an outage.
        throw new ObsoleteGuessConflict();
      }
      throw error;
    }
  }
  async due(now: number, limit: number) {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.table,
        FilterExpression:
          "attribute_exists(activeGuess) AND #active.#eligible <= :now",
        ExpressionAttributeNames: {
          "#active": "activeGuess",
          "#eligible": "eligibleAt",
        },
        ExpressionAttributeValues: { ":now": now },
        ProjectionExpression: "playerId, activeGuess",
        Limit: limit,
        ...(this.cursor ? { ExclusiveStartKey: this.cursor } : {}),
      }),
    );
    // `Limit` bounds evaluated items per page (the filter runs after it); the
    // cursor sweep gives eventual whole-table coverage across ticks for demo scale.
    this.cursor = result.LastEvaluatedKey;
    return (result.Items ?? []).map((item) => ({
      playerId: item.playerId as string,
      guess: item.activeGuess as PendingGuess,
    }));
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
