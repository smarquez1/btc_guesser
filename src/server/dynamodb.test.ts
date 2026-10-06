import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { DynamoPlayerStore } from "./dynamodb.js";
import {
  ActiveGuessConflict,
  type PendingGuess,
  type PlayerRecord,
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
});
