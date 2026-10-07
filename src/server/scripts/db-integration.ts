import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { buildApp } from "../app.js";
import {
  ActiveGuessConflict,
  ObsoleteGuessConflict,
  type PendingGuess,
  type ResolvedGuess,
} from "../domain/player.js";
import { isAwsError } from "../persistence/aws-error.js";
import { createDynamoClient } from "../persistence/client.js";
import {
  ensureTable,
  requireLocalEndpoint,
} from "../persistence/local-table.js";
import { DynamoPlayerStore } from "../persistence/player-store.js";
import { createResolver } from "../resolution/resolver.js";

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
  // Resolver restart recovery: a due guess persisted in DynamoDB is discovered
  // and scored exactly once by a fresh resolver built over a new store instance
  // on the same table (proves discovery comes from the table, not memory).
  const restartId = randomUUID();
  await store.create({
    playerId: restartId,
    displayName: "Restart test",
    sessionDigest: "test-only",
    score: 0,
  });
  const restartGuess: PendingGuess = {
    id: randomUUID(),
    direction: "up",
    startingPrice: "1.000000001",
    acceptedAt: 1000,
    eligibleAt: 2000,
  };
  await store.accept(restartId, restartGuess);
  const restartClient = createDynamoClient();
  const restartStore = new DynamoPlayerStore(
    DynamoDBDocumentClient.from(restartClient),
    table,
  );
  const restartResolver = createResolver({
    store: restartStore,
    // Injected observation and clock: no live provider, no real-minute wait.
    trusted: async () => ({
      price: "1.000000002",
      providerTradeAt: new Date(61000).toISOString(),
      receivedAt: 61000,
    }),
    now: () => 61000,
    pollMs: 1000,
    batchLimit: 50,
  });
  await restartResolver.sweep();
  await restartResolver.close();
  const restarted = await restartStore.get(restartId);
  assert.equal(restarted?.score, 1);
  assert.equal(restarted?.activeGuess, undefined);
  assert.equal(restarted?.latestGuess?.id, restartGuess.id);
  assert.equal(restarted?.latestGuess?.result, "correct");
  await assert.rejects(
    restartStore.resolve(restartId, {
      ...restartGuess,
      result: "correct",
      scoreDelta: 1,
      resolvedAt: 61000,
      observedPrice: "1.000000002",
      observedAt: 61000,
    }),
    (error) => error instanceof ObsoleteGuessConflict,
  );
  assert.equal((await restartStore.get(restartId))?.score, 1);
  restartClient.destroy();
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
  // Persistence unavailable against the real SDK: a store pointed at a table
  // that does not exist must surface HTTP 503 without leaking internals.
  const missingTable = `btc-guesser-test-missing-${randomUUID()}`;
  const unavailableApp = buildApp({
    store: new DynamoPlayerStore(
      DynamoDBDocumentClient.from(client),
      missingTable,
    ),
    now: () => 1000,
    price: async () => ({
      price: "123.000000001",
      providerTradeAt: "2026-10-06T00:00:00Z",
      receivedAt: 1234,
    }),
  });
  try {
    const phantomToken = "b".repeat(64);
    const unavailable = await unavailableApp.inject({
      method: "POST",
      url: "/api/guesses",
      cookies: { btc_player: `phantom.${phantomToken}` },
      payload: { direction: "up" },
    });
    assert.equal(unavailable.statusCode, 503, unavailable.body);
    assert.deepEqual(unavailable.json(), { error: "persistence_unavailable" });
    assert.ok(!unavailable.body.includes(phantomToken));
    assert.ok(!unavailable.body.includes("ResourceNotFound"));
    assert.ok(!unavailable.body.includes(missingTable));
    assert.ok(!unavailable.body.includes("DynamoDB"));
    // The failed accept must not have created the table or written anything.
    let tableStillMissing = false;
    try {
      await client.send(new DescribeTableCommand({ TableName: missingTable }), {
        abortSignal: AbortSignal.timeout(2_000),
      });
    } catch (error) {
      tableStillMissing = isAwsError(error, "ResourceNotFoundException");
    }
    assert.ok(tableStillMissing, "missing table must remain uncreated");
  } finally {
    await unavailableApp.close();
  }
  console.info(
    "DynamoDB Local integration passed: session/state restored across app instances; concurrent conditional update accepted once; due discovery plus conditional resolution scored once without double counting; resolver restart recovery discovered a persisted guess from the table, scored once, and rejected a second resolve; a nonexistent table returned 503 persistence_unavailable without writing or leaking internals.",
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
