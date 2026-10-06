import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { buildApp } from "./app.js";
import { createDynamoClient, DynamoPlayerStore } from "./dynamodb.js";
import { ensureTable, requireLocalEndpoint } from "./local-table.js";
import { ActiveGuessConflict, type PendingGuess } from "./players.js";

requireLocalEndpoint();
const table = `btc-guesser-test-${randomUUID()}`;
const client = createDynamoClient();
const store = new DynamoPlayerStore(DynamoDBDocumentClient.from(client), table);
const options = {
  store,
  now: () => 1000,
  price: async () => ({
    price: "123.000000001",
    providerTradeAt: "2026-10-06T00:00:00Z",
    receivedAt: 1234,
  }),
};
let app = buildApp(options);
try {
  await ensureTable(client, table);
  // Exercise the actual adapter condition even if route scheduling serializes reads.
  const atomicId = randomUUID();
  await store.create({
    playerId: atomicId,
    displayName: "Atomic test",
    sessionDigest: "test-only",
    score: 0,
  });
  const guess: PendingGuess = {
    id: randomUUID(),
    direction: "up",
    startingPrice: "1.000000001",
    acceptedAt: 1000,
    eligibleAt: 61000,
  };
  const atomicResults = await Promise.allSettled([
    store.accept(atomicId, guess),
    store.accept(atomicId, { ...guess, id: randomUUID(), direction: "down" }),
  ]);
  assert.equal(
    atomicResults.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = atomicResults.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" &&
      rejected.reason instanceof ActiveGuessConflict,
  );
  assert.ok((await store.get(atomicId))?.activeGuess);
  const created = await app.inject({
    method: "POST",
    url: "/api/players",
    payload: { displayName: "Local test" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const cookie = created.cookies[0];
  assert.ok(cookie);
  const cookies = { btc_player: cookie.value };
  const results = await Promise.all(
    ["up", "down"].map((direction) =>
      app.inject({
        method: "POST",
        url: "/api/guesses",
        cookies,
        payload: { direction },
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [201, 409],
  );
  const accepted = results.find((result) => result.statusCode === 201)?.json();
  assert.equal(accepted.activeGuess.startingPrice, "123.000000001");
  assert.equal(accepted.activeGuess.eligibleAt, 61000);
  await app.close();
  app = buildApp(options);
  const restored = await app.inject({ url: "/api/player", cookies });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json(), accepted);
  console.info(
    "DynamoDB Local integration passed: session/state restored across app instances; concurrent conditional update accepted once.",
  );
} finally {
  await app.close();
  try {
    // Only this run's unique test table; never the configured development table.
    await client.send(new DeleteTableCommand({ TableName: table }), {
      abortSignal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    if (
      !(error instanceof Error && error.name === "ResourceNotFoundException")
    ) {
      console.error(`Could not clean integration table ${table}`, error);
      process.exitCode = 1;
    }
  } finally {
    client.destroy();
  }
}
