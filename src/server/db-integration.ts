import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { buildApp } from "./app.js";
import { isAwsError } from "./aws-error.js";
import { createDynamoClient, DynamoPlayerStore } from "./dynamodb.js";
import { ensureTable, requireLocalEndpoint } from "./local-table.js";
import {
  ActiveGuessConflict,
  ObsoleteGuessConflict,
  type PendingGuess,
  type ResolvedGuess,
} from "./players.js";

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
  // Genuine resolution: due discovery, atomic scoring, and no double counting.
  const resolveId = randomUUID();
  await store.create({
    playerId: resolveId,
    displayName: "Resolve test",
    sessionDigest: "test-only",
    score: 0,
  });
  const dueGuess: PendingGuess = {
    id: randomUUID(),
    direction: "up",
    startingPrice: "1.000000001",
    acceptedAt: 1000,
    eligibleAt: 2000,
  };
  await store.accept(resolveId, dueGuess);
  const discovered = await store.due(61000, 10);
  assert.ok(
    discovered.some(
      (entry) => entry.playerId === resolveId && entry.guess.id === dueGuess.id,
    ),
    "eligible guess should be discovered by due()",
  );
  const resolution: ResolvedGuess = {
    ...dueGuess,
    result: "correct",
    scoreDelta: 1,
    resolvedAt: 61000,
    observedPrice: "1.000000002",
    observedAt: 61000,
  };
  const resolvedPlayer = await store.resolve(resolveId, resolution);
  assert.equal(resolvedPlayer.score, 1);
  assert.equal(resolvedPlayer.activeGuess, undefined);
  assert.equal(resolvedPlayer.latestGuess?.id, dueGuess.id);
  assert.equal(resolvedPlayer.latestGuess?.result, "correct");
  await assert.rejects(
    store.resolve(resolveId, resolution),
    (error) => error instanceof ObsoleteGuessConflict,
  );
  assert.equal((await store.get(resolveId))?.score, 1);
  // Concurrent duplicates on a fresh guess: exactly one score change.
  const duplicateId = randomUUID();
  await store.create({
    playerId: duplicateId,
    displayName: "Duplicate test",
    sessionDigest: "test-only",
    score: 0,
  });
  const duplicateGuess: PendingGuess = {
    id: randomUUID(),
    direction: "down",
    startingPrice: "1.000000001",
    acceptedAt: 1000,
    eligibleAt: 2000,
  };
  await store.accept(duplicateId, duplicateGuess);
  const duplicateResolution: ResolvedGuess = {
    ...duplicateGuess,
    result: "incorrect",
    scoreDelta: -1,
    resolvedAt: 61000,
    observedPrice: "1.000000001",
    observedAt: 61000,
  };
  const duplicates = await Promise.allSettled([
    store.resolve(duplicateId, duplicateResolution),
    store.resolve(duplicateId, duplicateResolution),
  ]);
  assert.equal(
    duplicates.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    duplicates.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof ObsoleteGuessConflict,
    ).length,
    1,
  );
  assert.equal((await store.get(duplicateId))?.score, -1);
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
  assert.ok(accepted);
  assert.equal(accepted.activeGuess.startingPrice, "123.000000001");
  assert.equal(accepted.activeGuess.eligibleAt, 61000);
  await app.close();
  app = buildApp(options);
  const restored = await app.inject({ url: "/api/player", cookies });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json(), accepted);
  console.info(
    "DynamoDB Local integration passed: session/state restored across app instances; concurrent conditional update accepted once; due discovery plus conditional resolution scored once without double counting.",
  );
} finally {
  await app.close();
  try {
    // Only this run's unique test table; never the configured development table.
    await client.send(new DeleteTableCommand({ TableName: table }), {
      abortSignal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      console.error(`Could not clean integration table ${table}`, error);
      process.exitCode = 1;
    }
  } finally {
    client.destroy();
  }
}
