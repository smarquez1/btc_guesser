import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppOptions, buildApp } from "./app.js";
import {
  ActiveGuessConflict,
  type DueGuess,
  ObsoleteGuessConflict,
  type PlayerRecord,
  type PlayerStore,
  type ResolvedGuess,
} from "./players.js";
import { createPricingService } from "./pricing.js";

function memoryStore() {
  const records = new Map<string, PlayerRecord>();
  const store: PlayerStore = {
    create: vi.fn(async (player) => {
      records.set(player.playerId, structuredClone(player));
    }),
    get: vi.fn(async (id) => {
      const record = records.get(id);
      return record && structuredClone(record);
    }),
    accept: vi.fn(async (id, guess) => {
      const record = records.get(id);
      if (!record || record.activeGuess) throw new ActiveGuessConflict();
      record.activeGuess = guess;
      return structuredClone(record);
    }),
    due: vi.fn(async (now, limit) => {
      const due: DueGuess[] = [];
      for (const record of records.values()) {
        const active = record.activeGuess;
        if (active && active.eligibleAt <= now && due.length < limit)
          due.push({
            playerId: record.playerId,
            guess: structuredClone(active),
          });
      }
      return due;
    }),
    resolve: vi.fn(async (id, guess) => {
      const record = records.get(id);
      if (!record?.activeGuess || record.activeGuess.id !== guess.id)
        throw new ObsoleteGuessConflict();
      record.score += guess.scoreDelta;
      record.activeGuess = undefined;
      record.latestGuess = structuredClone(guess);
      return structuredClone(record);
    }),
  };
  return { store, records };
}
const apps: FastifyInstance[] = [];
function setup(options: AppOptions = {}) {
  const app = buildApp(options);
  apps.push(app);
  return app;
}
async function create(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/players",
    payload: { displayName: " Ada " },
  });
  return { response, cookies: { btc_player: response.cookies[0].value } };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe("player API", () => {
  it("hands off shared live display/trusted observations on existing routes and owns lifecycle", async () => {
    const { store } = memoryStore();
    const now = Date.parse("2026-10-06T00:00:00Z");
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        price: "123.00001",
        time: new Date(now).toISOString(),
      }),
    }));
    const service = createPricingService({ fetch, now: () => now });
    const start = vi.spyOn(service, "start");
    const close = vi.spyOn(service, "close");
    const app = setup({ store, pricingService: () => service });
    expect(start).not.toHaveBeenCalled();
    await app.ready();
    expect(start).toHaveBeenCalledOnce();
    await service.trusted();
    const pricing = {
      status: "fresh",
      observation: {
        price: "123.00001",
        providerTradeAt: new Date(now).toISOString(),
        receivedAt: now,
      },
    };
    const { response, cookies } = await create(app);
    expect(response.json().pricing).toEqual(pricing);
    expect(
      (await app.inject({ url: "/api/player", cookies })).json().pricing,
    ).toEqual(pricing);
    const guess = await app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies,
      payload: { direction: "up" },
    });
    expect(guess.statusCode).toBe(201);
    expect(guess.json().pricing).toEqual(pricing);
    expect(guess.json().activeGuess.startingPrice).toBe("123.00001");
    expect(fetch).toHaveBeenCalledOnce();
    await app.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it("starts the resolver only with persistence and trusted pricing, and closes it during shutdown", async () => {
    const { store } = memoryStore();
    const now = Date.parse("2026-10-06T00:00:00Z");
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ price: "1", time: new Date(now).toISOString() }),
    }));
    const events: string[] = [];
    const resolver = {
      start: () => events.push("resolver-start"),
      close: async () => {
        events.push("resolver-close");
      },
      sweep: async () => {},
    };
    const resolverService = vi.fn(() => {
      events.push("resolver-created");
      return resolver;
    });
    const app = setup({
      store,
      pricingService: (log) =>
        createPricingService({ fetch, now: () => now, log }),
      resolverService,
    });
    await app.ready();
    expect(resolverService).toHaveBeenCalledOnce();
    expect(events).toEqual(["resolver-created", "resolver-start"]);
    await app.close();
    expect(events).toEqual([
      "resolver-created",
      "resolver-start",
      "resolver-close",
    ]);
    const offline = vi.fn(() => resolver);
    await setup({
      pricingService: (log) =>
        createPricingService({ fetch, now: () => now, log }),
      resolverService: offline,
    }).ready();
    expect(offline).not.toHaveBeenCalled();
  });
  it("shows stale last-known data without allowing a submission write", async () => {
    const { store } = memoryStore();
    const pricing = {
      status: "stale" as const,
      observation: {
        price: "1",
        providerTradeAt: "2026-10-06T00:00:00Z",
        receivedAt: 0,
      },
    };
    const app = setup({
      store,
      displayPricing: () => pricing,
      price: async () => null,
    });
    const { response, cookies } = await create(app);
    expect(response.json().pricing).toEqual(pricing);
    expect(
      (await app.inject({ url: "/api/player", cookies })).json().pricing,
    ).toEqual(pricing);
    const guess = await app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies,
      payload: { direction: "down" },
    });
    expect(guess.statusCode).toBe(503);
    expect(store.accept).not.toHaveBeenCalled();
  });
  it("creates distinct IDs for equal labels and restores a valid session across app instances", async () => {
    const { store } = memoryStore();
    const app = setup({ store });
    const first = await create(app);
    expect(first.response.statusCode).toBe(201);
    expect(first.response.json()).toEqual({
      id: expect.any(String),
      displayName: "Ada",
      score: 0,
      activeGuess: null,
      latestGuess: null,
      pricing: { status: "unavailable", observation: null },
    });
    const second = await create(app);
    expect(second.response.json().id).not.toBe(first.response.json().id);
    const restored = setup({ store });
    const read = await restored.inject({
      url: "/api/player",
      cookies: first.cookies,
    });
    expect(read.json()).toEqual(first.response.json());
    const repeat = await restored.inject({
      method: "POST",
      url: "/api/players",
      cookies: first.cookies,
      payload: { displayName: "Changed" },
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual(first.response.json());
    expect(repeat.cookies).toHaveLength(0);
  });
  it("uses a private session-only cookie with production security and stores only its digest", async () => {
    const { store, records } = memoryStore();
    const { response, cookies } = await create(
      setup({ store, production: true }),
    );
    const header = String(response.headers["set-cookie"]);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toMatch(/Max-Age|Expires/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    const credential = cookies.btc_player.split(".")[1];
    expect(JSON.stringify([...records.values()])).not.toContain(credential);
    expect(response.body).not.toContain("sessionDigest");
    expect(response.body).not.toContain(credential);
  });
  it("rejects missing, public-ID-only, tampered and unknown cookies", async () => {
    const { store } = memoryStore();
    const app = setup({ store });
    const { response, cookies } = await create(app);
    for (const cookie of [
      undefined,
      response.json().id,
      `${response.json().id}.${"0".repeat(64)}`,
      `${randomUUID()}.${cookies.btc_player.split(".")[1]}`,
    ]) {
      const read = await app.inject({
        url: "/api/player",
        cookies: cookie ? { btc_player: cookie } : {},
      });
      expect(read.statusCode).toBe(401);
      expect(read.headers["cache-control"]).toBe("no-store");
      const guess = await app.inject({
        method: "POST",
        url: "/api/guesses",
        cookies: cookie ? { btc_player: cookie } : {},
        payload: { direction: "up" },
      });
      expect(guess.statusCode).toBe(401);
    }
    const fresh = await app.inject({
      method: "POST",
      url: "/api/players",
      cookies: { btc_player: "invalid" },
      payload: { displayName: "Ada" },
    });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().id).not.toBe(response.json().id);
  });
  it.each([
    {},
    { displayName: "  " },
    { displayName: "x".repeat(81) },
    { displayName: 1 },
    { displayName: "Ada", score: 100 },
  ])("rejects invalid name body %j", async (payload) => {
    const { store } = memoryStore();
    const response = await setup({ store }).inject({
      method: "POST",
      url: "/api/players",
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });
  it("rejects direction/owned fields and malformed JSON without writes", async () => {
    const { store } = memoryStore();
    const app = setup({ store });
    const { cookies } = await create(app);
    for (const payload of [
      {},
      { direction: "UP" },
      { direction: "up", price: "1" },
      { direction: "up", acceptedAt: 0 },
      { direction: "down", eligibleAt: 0 },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/guesses",
            cookies,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/guesses",
          headers: { "content-type": "application/json" },
          payload: "{",
        })
      ).statusCode,
    ).toBe(400);
    expect(store.accept).not.toHaveBeenCalled();
  });
  it("does not write when the trusted price source is unavailable", async () => {
    const { store } = memoryStore();
    const app = setup({ store });
    const { cookies } = await create(app);
    const result = await app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies,
      payload: { direction: "up" },
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ error: "price_unavailable" });
    expect(store.accept).not.toHaveBeenCalled();
  });
  it.each([
    {
      status: 413,
      code: "payload_too_large",
      contentType: "application/json",
      payload: "x".repeat(1_048_577),
    },
    {
      status: 415,
      code: "unsupported_media_type",
      contentType: "application/private-test",
      payload: "private request details",
    },
  ])(
    "preserves framework $status with a sanitized response and no writes",
    async ({ status, code, contentType, payload }) => {
      const { store } = memoryStore();
      const result = await setup({ store }).inject({
        method: "POST",
        url: "/api/players",
        headers: { "content-type": contentType },
        payload,
      });
      expect(result.statusCode).toBe(status);
      expect(result.json()).toEqual({ error: code });
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(store.create).not.toHaveBeenCalled();
    },
  );
  it("accepts once concurrently with exact server price/time and preserves latest state", async () => {
    const { store, records } = memoryStore();
    const app = setup({
      store,
      now: () => 1234,
      price: async () => ({
        price: "12345.123456789012345",
        providerTradeAt: "2026-10-06T00:00:00Z",
        receivedAt: 1234,
      }),
    });
    const { response, cookies } = await create(app);
    const latest: ResolvedGuess = {
      id: "previous",
      direction: "down",
      startingPrice: "1",
      acceptedAt: 0,
      eligibleAt: 60000,
      result: "correct",
      scoreDelta: 1,
      resolvedAt: 61234,
      observedPrice: "0.999",
      observedAt: 61234,
    };
    const record = records.get(response.json().id);
    if (!record) throw new Error("Missing fixture");
    record.latestGuess = latest;
    record.score = 7;
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
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const accepted = results.find((result) => result.statusCode === 201);
    expect(accepted?.json()).toMatchObject({
      score: 7,
      latestGuess: latest,
      activeGuess: {
        startingPrice: "12345.123456789012345",
        acceptedAt: 1234,
        eligibleAt: 61234,
      },
    });
    expect(accepted?.body).not.toContain("sessionDigest");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/guesses",
          cookies,
          payload: { direction: "up" },
        })
      ).statusCode,
    ).toBe(409);
    const repeat = await app.inject({
      method: "POST",
      url: "/api/players",
      cookies,
      payload: { displayName: "Reset?" },
    });
    expect(repeat.json()).toEqual(accepted?.json());
  });
  it("reports persistence configuration and infrastructure failures without masking them as conflicts or leaking errors", async () => {
    expect(
      (
        await setup().inject({
          method: "POST",
          url: "/api/players",
          payload: { displayName: "Ada" },
        })
      ).statusCode,
    ).toBe(503);
    const { store } = memoryStore();
    const app = setup({
      store,
      price: async () => ({
        price: "1",
        providerTradeAt: "2026-10-06T00:00:00Z",
        receivedAt: 1234,
      }),
    });
    const { cookies } = await create(app);
    vi.mocked(store.accept).mockRejectedValue(
      Object.assign(new Error("private credentials"), {
        statusCode: 400,
        code: "ValidationException",
      }),
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies,
      payload: { direction: "up" },
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain("private credentials");
    expect(result.json()).toEqual({ error: "persistence_unavailable" });
  });
});
describe("guess acceptance window", () => {
  it("sets the eligibility window to 60000 from acceptance", async () => {
    const { store } = memoryStore();
    const observation = {
      price: "43210.5",
      providerTradeAt: "2026-10-06T00:00:00Z",
      receivedAt: 1000,
    };
    const app = setup({
      store,
      now: () => 1000,
      price: async () => observation,
    });
    const { cookies } = await create(app);
    const guess = await app.inject({
      method: "POST",
      url: "/api/guesses",
      cookies,
      payload: { direction: "up" },
    });
    expect(guess.statusCode).toBe(201);
    const active = guess.json().activeGuess;
    expect(active.startingPrice).toBe(observation.price);
    expect(active.acceptedAt).toBe(1000);
    expect(active.eligibleAt - active.acceptedAt).toBe(60000);
  });
});
