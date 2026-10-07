// Test-only launcher for the Playwright journey.
//
// It builds the real Fastify app (`buildApp`) against an isolated DynamoDB Local
// table and an injected ticker `fetch`, so the browser drives the actual routes,
// resolver, and persistence without ever contacting Coinbase. A separate
// loopback-only control channel lets the test set the current price and reset
// state. Nothing here is imported by, or wired into, the deployed application.
//
// The real acceptance-window code path runs unchanged: the launcher sets
// GUESS_MIN_WAIT_MS (via the Playwright webServer env) so the runtime seam in
// `player/routes.ts` shortens the 60s window for this journey only.

import { randomUUID } from "node:crypto";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import Fastify from "fastify";
import { buildApp } from "../../src/server/app.js";
import { isAwsError } from "../../src/server/persistence/aws-error.js";
import { createDynamoClient } from "../../src/server/persistence/client.js";
import {
  ensureTable,
  requireLocalEndpoint,
} from "../../src/server/persistence/local-table.js";
import { DynamoPlayerStore } from "../../src/server/persistence/player-store.js";
import { guessMinWaitMs } from "../../src/server/player/routes.js";
import { validPrice } from "../../src/server/pricing/policy.js";
import { createPricingService } from "../../src/server/pricing/service.js";
import { createResolver } from "../../src/server/resolution/resolver.js";

requireLocalEndpoint();

const table = `btc-guesser-e2e-${randomUUID()}`;
const client = createDynamoClient();
const documentClient = DynamoDBDocumentClient.from(client);

const store = new DynamoPlayerStore(documentClient, table);

// Mutable, control-channel-driven price; the ticker never hits the network.
let currentPrice = "100.00";
const fakeFetch = async () => ({
  ok: true as const,
  json: async () => ({
    price: currentPrice,
    time: new Date().toISOString(),
  }),
});

let pricing: ReturnType<typeof createPricingService> | undefined;
const app = buildApp({
  logger: true,
  store,
  pricingService: (log) => {
    pricing = createPricingService({ log, fetch: fakeFetch });
    return pricing;
  },
  resolverService: (dependencies) =>
    createResolver({ ...dependencies, pollMs: 250, batchLimit: 50 }),
});

async function resetTable() {
  let ExclusiveStartKey: ScanCommandOutput["LastEvaluatedKey"];
  do {
    const scan = await documentClient.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: "playerId",
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }),
    );
    const keys = (scan.Items ?? []).map((item) => ({
      playerId: item.playerId as string,
    }));
    for (let index = 0; index < keys.length; index += 25) {
      const batch = keys.slice(index, index + 25);
      if (batch.length === 0) continue;
      await documentClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: batch.map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
    }
    ExclusiveStartKey = scan.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

// Loopback-only control channel; deliberately separate from the app under test.
const control = Fastify({ logger: false });
control.get("/health", async () => ({ ok: true }));
control.post("/price", async (request, reply) => {
  const body = request.body;
  const price =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { price?: unknown }).price
      : undefined;
  if (typeof price !== "string" || !validPrice(price))
    return reply.code(400).send({ ok: false, error: "invalid_price" });
  currentPrice = price;
  return { ok: true };
});
control.post("/reset", async () => {
  await resetTable();
  return { ok: true };
});

async function deleteUniqueTable() {
  // Safety guard: only ever remove this run's isolated table.
  if (!table.startsWith("btc-guesser-e2e-")) return;
  try {
    await client.send(new DeleteTableCommand({ TableName: table }), {
      abortSignal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException"))
      console.error(`Could not clean e2e table ${table}`, error);
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close().catch(() => {});
  await control.close().catch(() => {});
  await deleteUniqueTable();
  client.destroy();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
// Best-effort only: async cleanup cannot run after `exit` fires.
process.once("exit", () => client.destroy());

try {
  await ensureTable(client, table);
  await app.listen({ port: 3300, host: "127.0.0.1" });
  await control.listen({ port: 3301, host: "127.0.0.1" });
  // Warm the first observation so the browser's opening session response has a
  // fresh price instead of racing the first background poll.
  await pricing?.trusted();
  console.info(
    `e2e server ready: table=${table} guessMinWaitMs=${guessMinWaitMs()}`,
  );
} catch (error) {
  console.error("e2e server failed to start", error);
  await shutdown();
  process.exitCode = 1;
}
