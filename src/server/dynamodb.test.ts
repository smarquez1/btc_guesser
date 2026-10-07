import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import {
  DynamoPlayerStore,
  StorageDeadlineError,
  storagePolicy,
} from "./dynamodb.js";
import {
  ActiveGuessConflict,
  ObsoleteGuessConflict,
  type PendingGuess,
  type PlayerRecord,
  type PlayerStore,
  type ResolvedGuess,
} from "./players.js";

const player: PlayerRecord = {
  playerId: "player",
  displayName: "Ada",
  sessionDigest: "digest",
  score: 0,
};
const guess: PendingGuess = {
  id: "guess",
  direction: "up",
  startingPrice: "1.000000000001",
  acceptedAt: 100,
  eligibleAt: 60100,
};
const resolved: ResolvedGuess = {
  ...guess,
  result: "correct",
  scoreDelta: 1,
  resolvedAt: 61000,
  observedPrice: "1.000000000002",
  observedAt: 61000,
};
describe("DynamoDB command contract", () => {
  it("uses conditional creation, strong reads and an atomic active-guess update without null fields", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: player })
      .mockResolvedValueOnce({ Attributes: { ...player, activeGuess: guess } });
    const store = new DynamoPlayerStore({ send }, "table");
    await store.create(player);
    expect(await store.get("player")).toEqual(player);
    expect(await store.accept("player", guess)).toEqual({
      ...player,
      activeGuess: guess,
    });
    const put = send.mock.calls[0][0];
    expect(put).toBeInstanceOf(PutCommand);
    expect(put.input).toEqual({
      TableName: "table",
      Item: player,
      ConditionExpression: "attribute_not_exists(playerId)",
    });
    expect(put.input.Item).not.toHaveProperty("activeGuess");
    const get = send.mock.calls[1][0];
    expect(get).toBeInstanceOf(GetCommand);
    expect(get.input.ConsistentRead).toBe(true);
    const update = send.mock.calls[2][0];
    expect(update).toBeInstanceOf(UpdateCommand);
    expect(update.input).toEqual({
      TableName: "table",
      Key: { playerId: "player" },
      UpdateExpression: "SET activeGuess = :guess",
      ConditionExpression:
        "attribute_exists(playerId) AND attribute_not_exists(activeGuess)",
      ExpressionAttributeValues: { ":guess": guess },
      ReturnValues: "ALL_NEW",
    });
  });
  it("maps only active-player conditional failures to conflicts", async () => {
    const conditional = Object.assign(new Error("condition"), {
      name: "ConditionalCheckFailedException",
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(conditional)
      .mockResolvedValueOnce({ Item: { ...player, activeGuess: guess } });
    const store = new DynamoPlayerStore({ send }, "table");
    await expect(store.accept("player", guess)).rejects.toBeInstanceOf(
      ActiveGuessConflict,
    );
    send.mockRejectedValueOnce(conditional).mockResolvedValueOnce({});
    await expect(store.accept("player", guess)).rejects.toThrow(
      "Player no longer exists",
    );
    const outage = new Error("network");
    send.mockRejectedValueOnce(outage);
    await expect(store.accept("player", guess)).rejects.toBe(outage);
    send.mockRejectedValueOnce(conditional);
    await expect(store.create(player)).rejects.toBe(conditional);
  });
  it("resolves the pinned guess and clears active state in one conditional update", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Attributes: { ...player, score: 1, latestGuess: resolved },
    });
    const store = new DynamoPlayerStore({ send }, "table");
    const record = await store.resolve("player", resolved);
    expect(record).toEqual({ ...player, score: 1, latestGuess: resolved });
    expect(record).not.toHaveProperty("activeGuess");
    const update = send.mock.calls[0][0];
    expect(update).toBeInstanceOf(UpdateCommand);
    expect(update.input).toEqual({
      TableName: "table",
      Key: { playerId: "player" },
      UpdateExpression:
        "SET latestGuess = :guess REMOVE activeGuess ADD score :delta",
      ConditionExpression:
        "attribute_exists(playerId) AND #active.#id = :guessId",
      ExpressionAttributeNames: { "#active": "activeGuess", "#id": "id" },
      ExpressionAttributeValues: {
        ":guess": resolved,
        ":delta": 1,
        ":guessId": "guess",
      },
      ReturnValues: "ALL_NEW",
    });
  });
  it("maps resolve conditional failures to obsolete conflicts and rethrows others", async () => {
    const conditional = Object.assign(new Error("condition"), {
      name: "ConditionalCheckFailedException",
    });
    const send = vi.fn().mockRejectedValueOnce(conditional);
    const store = new DynamoPlayerStore({ send }, "table");
    await expect(store.resolve("player", resolved)).rejects.toBeInstanceOf(
      ObsoleteGuessConflict,
    );
    const outage = new Error("network");
    send.mockRejectedValueOnce(outage);
    await expect(store.resolve("player", resolved)).rejects.toBe(outage);
  });
  it("scans one bounded page of due guesses and carries the cursor", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [{ playerId: "player", activeGuess: guess }],
        LastEvaluatedKey: { playerId: "player" },
      })
      .mockResolvedValueOnce({ Items: [] });
    const store = new DynamoPlayerStore({ send }, "table");
    expect(await store.due(61000, 10)).toEqual([{ playerId: "player", guess }]);
    const first = send.mock.calls[0][0];
    expect(first).toBeInstanceOf(ScanCommand);
    expect(first.input).toEqual({
      TableName: "table",
      FilterExpression:
        "attribute_exists(activeGuess) AND #active.#eligible <= :now",
      ExpressionAttributeNames: {
        "#active": "activeGuess",
        "#eligible": "eligibleAt",
      },
      ExpressionAttributeValues: { ":now": 61000 },
      ProjectionExpression: "playerId, activeGuess",
      Limit: 10,
    });
    expect(first.input).not.toHaveProperty("ExclusiveStartKey");
    await store.due(61000, 10);
    const second = send.mock.calls[1][0];
    expect(second.input.ExclusiveStartKey).toEqual({ playerId: "player" });
  });
  it("restarts a fresh sweep after a page completes without a cursor", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: { playerId: "player" },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });
    const store = new DynamoPlayerStore({ send }, "table");
    await store.due(1, 5);
    await store.due(2, 5);
    await store.due(3, 5);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      playerId: "player",
    });
    expect(send.mock.calls[2][0].input).not.toHaveProperty("ExclusiveStartKey");
  });
});
describe("storage deadline", () => {
  it("rejects a hung operation with StorageDeadlineError after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(() => new Promise<never>(() => {}));
      const store = new DynamoPlayerStore({ send }, "table");
      const pending = store.create(player);
      const assertion =
        expect(pending).rejects.toBeInstanceOf(StorageDeadlineError);
      await vi.advanceTimersByTimeAsync(storagePolicy.deadlineMs);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not raise an unhandled rejection when a timed-out operation settles late", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      let settleLate!: () => void;
      const send = vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            settleLate = () => reject(new Error("late"));
          }),
      );
      const store = new DynamoPlayerStore({ send }, "table");
      const pending = store.create(player);
      const assertion =
        expect(pending).rejects.toBeInstanceOf(StorageDeadlineError);
      await vi.advanceTimersByTimeAsync(storagePolicy.deadlineMs);
      await assertion;
      settleLate();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", listener);
      vi.useRealTimers();
    }
    expect(unhandled).toEqual([]);
  });

  it("maps a storage deadline to 503 persistence_unavailable on a player route", async () => {
    const store: PlayerStore = {
      create: vi.fn(async () => {}),
      get: vi.fn(async () => {
        throw new StorageDeadlineError();
      }),
      accept: vi.fn(async () => player),
      due: vi.fn(async () => []),
      resolve: vi.fn(async () => player),
    };
    const app = buildApp({ store });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/player",
        cookies: { btc_player: `${"a".repeat(8)}.${"b".repeat(64)}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "persistence_unavailable" });
    } finally {
      await app.close();
    }
  });
});
