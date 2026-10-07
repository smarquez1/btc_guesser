import {
  type DynamoDBDocumentClient,
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
} from "../domain/player.js";
import { isAwsError } from "./aws-error.js";

const ACTIVE_GUESS_NAMES = { "#active": "activeGuess" } as const;

export const storagePolicy = { deadlineMs: 5_000 } as const;
export class StorageDeadlineError extends Error {}
// Bounds every storage operation so a hung client cannot stall routes or the
// resolver. The late-settlement catch is mandatory: a timed-out operation may
// still reject after the race settles, which would otherwise be unhandled.
async function withDeadline<T>(
  op: Promise<T>,
  ms = storagePolicy.deadlineMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StorageDeadlineError()), ms);
  });
  try {
    return await Promise.race([op, deadline]);
  } finally {
    clearTimeout(timer);
    op.catch(() => {});
  }
}

function updatedPlayer(result: {
  Attributes?: Record<string, unknown>;
}): PlayerRecord {
  if (!result.Attributes) throw new Error("DynamoDB update returned no player");
  return result.Attributes as unknown as PlayerRecord;
}

export class DynamoPlayerStore implements PlayerStore {
  // One Scan page per due() call; the cursor carries the sweep across ticks.
  private cursor?: NonNullable<ScanCommandOutput["LastEvaluatedKey"]>;
  constructor(
    private readonly client: Pick<DynamoDBDocumentClient, "send">,
    private readonly table: string,
  ) {}
  async create(player: PlayerRecord) {
    await withDeadline(
      this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: player,
          ConditionExpression: "attribute_not_exists(playerId)",
        }),
      ),
    );
  }
  async get(playerId: string) {
    const result = await withDeadline(
      this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { playerId },
          ConsistentRead: true,
        }),
      ),
    );
    return result.Item as PlayerRecord | undefined;
  }
  async accept(playerId: string, guess: PendingGuess) {
    try {
      const result = await withDeadline(
        this.client.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { playerId },
            UpdateExpression: "SET activeGuess = :guess",
            ConditionExpression:
              "attribute_exists(playerId) AND attribute_not_exists(activeGuess)",
            ExpressionAttributeValues: { ":guess": guess },
            ReturnValues: "ALL_NEW",
          }),
        ),
      );
      return updatedPlayer(result);
    } catch (error) {
      if (isAwsError(error, "ConditionalCheckFailedException")) {
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
      const result = await withDeadline(
        this.client.send(
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
            ExpressionAttributeNames: { ...ACTIVE_GUESS_NAMES, "#id": "id" },
            ExpressionAttributeValues: {
              ":guess": guess,
              ":delta": guess.scoreDelta,
              ":guessId": guess.id,
            },
            ReturnValues: "ALL_NEW",
          }),
        ),
      );
      return updatedPlayer(result);
    } catch (error) {
      if (isAwsError(error, "ConditionalCheckFailedException")) {
        // Already resolved, replaced, or a missing player is expected, not an outage.
        throw new ObsoleteGuessConflict();
      }
      throw error;
    }
  }
  async due(now: number, limit: number) {
    const result = await withDeadline(
      this.client.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression:
            "attribute_exists(activeGuess) AND #active.#eligible <= :now",
          ExpressionAttributeNames: {
            ...ACTIVE_GUESS_NAMES,
            "#eligible": "eligibleAt",
          },
          ExpressionAttributeValues: { ":now": now },
          ProjectionExpression: "playerId, activeGuess",
          Limit: limit,
          ...(this.cursor ? { ExclusiveStartKey: this.cursor } : {}),
        }),
      ),
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
