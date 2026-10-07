import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import {
  ActiveGuessConflict,
  type PlayerRecord,
  type PlayerStore,
} from "../domain/player.js";
import { digestToken } from "./auth.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const token = "a".repeat(64);
const player: PlayerRecord = {
  playerId: "fixture-player",
  displayName: "SEEDED_PRIVATE_NAME",
  score: 0,
  sessionDigest: digestToken(token),
};
const seededError = () =>
  Object.assign(
    new Error(`SEEDED_SDK_MESSAGE ${token} ${player.sessionDigest}`),
    { name: "SEEDED_ERROR_NAME", request: { cookie: token }, item: player },
  );
function fixture() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const store: PlayerStore = {
    create: vi.fn(async () => {}),
    get: vi.fn(async () => player),
    accept: vi.fn(async () => {
      throw new ActiveGuessConflict();
    }),
    due: vi.fn(async () => []),
    resolve: vi.fn(async () => player),
  };
  const logs = () =>
    output.trim()
      ? output
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  const cookies = { btc_player: `${player.playerId}.${token}` };
  const ids: string[] = [];
  const build = (options: Parameters<typeof buildApp>[0] = {}) => {
    const app = buildApp({ logger: { stream }, store, ...options });
    app.addHook("onRequest", async (request) => {
      ids.push(request.id);
    });
    apps.push(app);
    return app;
  };
  const assertPrivate = (responses: string[] = []) => {
    const text = output + responses.join("");
    for (const secret of [
      token,
      player.playerId,
      player.displayName,
      player.sessionDigest,
      "SEEDED_SDK_MESSAGE",
      "SEEDED_ERROR_NAME",
      "SEEDED_QUERY",
      "SEEDED_HEADER",
      "SEEDED_IP",
    ])
      expect(text).not.toContain(secret);
    for (const entry of logs()) {
      expect(entry.requestId).toBe(entry.reqId);
      expect(ids).toContain(entry.requestId);
      expect(Object.keys(entry).sort()).toEqual(
        [
          "category",
          "event",
          "hostname",
          "level",
          "msg",
          "operation",
          "pid",
          "reqId",
          "requestId",
          "time",
        ].sort(),
      );
    }
  };
  return { store, logs, cookies, ids, build, assertPrivate };
}

it("bounds write failure logs independently of healthy reads and logs recovery once with safe server correlation", async () => {
  const f = fixture();
  let now = 100;
  let failed = true;
  vi.mocked(f.store.accept).mockImplementation(async () => {
    if (failed) throw seededError();
    throw new ActiveGuessConflict();
  });
  const app = f.build({
    now: () => now,
    price: async () => ({
      price: "1",
      receivedAt: now,
      providerTradeAt: "2026-10-06T00:00:00Z",
    }),
  });
  const request = () =>
    app.inject({
      method: "POST",
      url: "/api/guesses?secret=SEEDED_QUERY",
      headers: {
        "x-request-id": "SEEDED_HEADER",
        "x-forwarded-for": "SEEDED_IP",
      },
      cookies: f.cookies,
      payload: { direction: "up" },
    });
  const bodies: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await request();
    expect(result.statusCode).toBe(503);
    bodies.push(result.body);
  }
  expect(f.logs()).toHaveLength(1);
  expect(f.logs()[0]).toMatchObject({
    level: 50,
    category: "persistence_failure",
    operation: "storage_accept",
    requestId: f.ids[0],
  });
  now += 60_000;
  await request();
  expect(f.logs()).toHaveLength(2);
  failed = false;
  expect((await request()).statusCode).toBe(409);
  await request();
  expect(f.logs()).toHaveLength(3);
  expect(f.logs()[2]).toMatchObject({
    level: 30,
    category: "recovery",
    operation: "storage_accept",
  });
  failed = true;
  await request();
  expect(f.logs()).toHaveLength(4);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/guesses",
        payload: { direction: "bad" },
      })
    ).statusCode,
  ).toBe(400);
  expect((await app.inject("/api/player")).statusCode).toBe(401);
  expect(f.logs()).toHaveLength(4);
  f.assertPrivate(bodies);
});

it("distinguishes unavailable/throwing price from persistence and recovers once", async () => {
  const f = fixture();
  let now = 0;
  let mode: "missing" | "throw" | "fresh" = "missing";
  const app = f.build({
    now: () => now,
    price: async () => {
      if (mode === "throw") throw seededError();
      return mode === "missing"
        ? null
        : {
            price: "1",
            receivedAt: now,
            providerTradeAt: "2026-10-06T00:00:00Z",
          };
    },
  });
  const request = () =>
    app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies: f.cookies,
      payload: { direction: "up" },
    });
  const missing = await request();
  expect(missing.json()).toEqual({ error: "price_unavailable" });
  await request();
  expect(f.logs()).toHaveLength(1);
  expect(f.logs()[0]).toMatchObject({
    level: 40,
    category: "price_unavailable",
    operation: "price",
  });
  now = 60_000;
  mode = "throw";
  const thrown = await request();
  expect(thrown.json()).toEqual({ error: "price_unavailable" });
  expect(f.logs()[1]).toMatchObject({ level: 40, category: "price_failure" });
  expect(f.store.accept).not.toHaveBeenCalled();
  mode = "fresh";
  await request();
  await request();
  expect(f.logs()).toHaveLength(3);
  expect(f.logs()[2]).toMatchObject({
    level: 30,
    category: "recovery",
    operation: "price",
  });
  mode = "throw";
  await request();
  expect(f.logs()).toHaveLength(4);
  f.assertPrivate([missing.body, thrown.body]);
});

it("sanitizes unexpected request failures, recovers once, and warns about missing persistence without routine success logs", async () => {
  const f = fixture();
  let broken = true;
  const app = f.build({
    id: () => {
      if (broken) throw seededError();
      return "new-player";
    },
  });
  const request = () =>
    app.inject({
      method: "POST",
      url: "/api/players",
      payload: { displayName: player.displayName },
    });
  const result = await request();
  expect(result.statusCode).toBe(503);
  await request();
  expect(f.logs()).toHaveLength(1);
  expect(f.logs()[0]).toMatchObject({
    level: 50,
    category: "request_failure",
    operation: "request",
  });
  broken = false;
  await request();
  await request();
  expect(f.logs()).toHaveLength(2);
  expect(f.logs()[1]).toMatchObject({
    level: 30,
    category: "recovery",
    operation: "request",
  });
  const missing = f.build({ store: undefined });
  await missing.inject("/api/player");
  await missing.inject("/api/player");
  expect(f.logs()).toHaveLength(3);
  expect(f.logs()[2]).toMatchObject({
    level: 40,
    category: "persistence_unconfigured",
  });
  f.assertPrivate([result.body]);
});
