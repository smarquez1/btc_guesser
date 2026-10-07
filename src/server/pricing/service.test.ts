import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  comparePrices,
  isFresh,
  tradeTimestamp,
  validPrice,
} from "./policy.js";
import { createPricingService } from "./service.js";

const epoch = Date.parse("2026-10-06T00:00:00Z");
const ticker = {
  price: "000123.1234567890123456789",
  time: new Date(epoch).toISOString(),
};
const response = (payload: unknown = ticker, ok = true) => ({
  ok,
  json: async () => payload,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("exact observations", () => {
  it.each([
    "0",
    "0.00",
    "-1",
    "+1",
    "1e3",
    ".1",
    "1.",
    " 1",
    "1".repeat(129),
    1,
    null,
  ])("rejects price %j", (value) => {
    expect(validPrice(value)).toBe(false);
  });
  it("compares full precision, unequal scales and leading zeros exactly", () => {
    expect(comparePrices("0001.000", "1")).toBe(0);
    expect(
      comparePrices("999999999999999999.000000000001", "999999999999999999"),
    ).toBe(1);
    expect(comparePrices("0.000000000001", "00.0000000000020")).toBe(-1);
    expect(() => comparePrices("0", "1")).toThrow();
    expect(validPrice("1".repeat(128))).toBe(true);
  });
  it.each([
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-10-06T24:00:00Z",
    "2026-10-06",
    "2026-10-06T00:00:00+00:00",
    "2026-10-06T00:00:60Z",
  ])("rejects impossible/non-UTC timestamp %s", (value) => {
    expect(tradeTimestamp(value)).toBeNull();
  });
  it("accepts leap dates and precise UTC fractions and enforces both freshness limits", () => {
    expect(tradeTimestamp("2024-02-29T00:00:00.123456Z")).not.toBeNull();
    const observation = {
      price: "1",
      providerTradeAt: new Date(epoch - 105_000).toISOString(),
      receivedAt: epoch,
    };
    expect(isFresh(observation, epoch + 15_000)).toBe(true);
    expect(isFresh(observation, epoch + 15_001)).toBe(false);
    expect(
      isFresh(
        {
          ...observation,
          providerTradeAt: new Date(epoch - 120_001).toISOString(),
        },
        epoch,
      ),
    ).toBe(false);
    expect(
      isFresh(
        {
          ...observation,
          providerTradeAt: new Date(epoch + 5000).toISOString(),
        },
        epoch,
      ),
    ).toBe(true);
    expect(
      isFresh(
        {
          ...observation,
          providerTradeAt: new Date(epoch + 5001).toISOString(),
        },
        epoch,
      ),
    ).toBe(false);
  });
});

describe("shared pricing", () => {
  it("polls successes without routine diagnostics and cleans up idle polling", async () => {
    const log = { warn: vi.fn(), info: vi.fn() };
    const fetch = vi.fn(async () => response());
    const service = createPricingService({ fetch, log });
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
      { signal: expect.any(AbortSignal) },
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(service.display().observation?.receivedAt).toBe(epoch + 15000);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    await service.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(service.display().status).toBe("stale");
  });
  it("uses one total deadline across a delayed fetch and body, not two timeouts", async () => {
    let release:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
          (resolve) => {
            release = resolve;
          },
        ),
    );
    const service = createPricingService({ fetch });
    const pending = service.trusted();
    await vi.advanceTimersByTimeAsync(2000);
    release?.({ ok: true, json: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeNull();
    await service.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares requests, preserves cache receipt and renews only on new valid responses even with the SAME ticker", async () => {
    const fetch = vi.fn(async () => response());
    const service = createPricingService({ fetch });
    const [a, b] = await Promise.all([service.trusted(), service.trusted()]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(a).toEqual({
      price: ticker.price,
      providerTradeAt: ticker.time,
      receivedAt: epoch,
    });
    expect(b).toEqual(a);
    // Example deadline lies between cached and newly observed identical trades.
    vi.setSystemTime(epoch + 4999);
    expect((await service.trusted())?.receivedAt).toBe(epoch);
    vi.setSystemTime(epoch + 5000);
    expect((await service.trusted())?.receivedAt).toBe(epoch + 5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    const shown = service.display();
    if (shown.observation) shown.observation.receivedAt = 0;
    expect(service.display().observation?.receivedAt).toBe(epoch + 5000);
    await service.close();
  });
  it.each([
    { payload: {}, category: "malformed", ok: true },
    {
      payload: { price: "0", time: ticker.time },
      category: "malformed",
      ok: true,
    },
    {
      payload: { price: "1", time: "2026-02-30T00:00:00Z" },
      category: "timestamp",
      ok: true,
    },
    {
      payload: { price: "1", time: new Date(epoch - 120001).toISOString() },
      category: "timestamp",
      ok: true,
    },
    {
      payload: { price: "1", time: new Date(epoch + 5001).toISOString() },
      category: "timestamp",
      ok: true,
    },
    { payload: ticker, category: "http", ok: false },
  ])(
    "rejects $category provider responses",
    async ({ payload, category, ok }) => {
      const log = { warn: vi.fn(), info: vi.fn() };
      const service = createPricingService({
        fetch: async () => response(payload, ok),
        log,
      });
      expect(await service.trusted()).toBeNull();
      expect(service.display()).toEqual({
        status: "unavailable",
        observation: null,
      });
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ category }),
        "Pricing degraded",
      );
      await service.close();
    },
  );
  it.each([-120000, 5000])(
    "accepts timestamp policy boundary %s",
    async (delta) => {
      const service = createPricingService({
        fetch: async () =>
          response({ price: "1", time: new Date(epoch + delta).toISOString() }),
      });
      expect(await service.trusted()).not.toBeNull();
      await service.close();
    },
  );
  it("keeps last known stale after failure, cooldowns concurrent retry and recovers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error("SECRET Ada cookie=value"))
      .mockResolvedValue(response());
    const log = { warn: vi.fn(), info: vi.fn() };
    const service = createPricingService({ fetch, log });
    await service.trusted();
    vi.setSystemTime(epoch + 5000);
    expect(await service.trusted()).toBeNull();
    expect(service.display()).toEqual({
      status: "stale",
      observation: {
        price: ticker.price,
        providerTradeAt: ticker.time,
        receivedAt: epoch,
      },
    });
    expect(await service.trusted()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(epoch + 10000);
    expect(await service.trusted()).not.toBeNull();
    expect(service.display().status).toBe("fresh");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ category: "transport", retryInMs: 5000 }),
      "Pricing degraded",
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ category: "recovery" }),
      "Pricing recovered",
    );
    expect(
      JSON.stringify([log.warn.mock.calls, log.info.mock.calls]),
    ).not.toMatch(/SECRET|Ada|cookie=value/);
    await service.close();
  });
  it("expires without reads refreshing receipt; provider age also expires independently", async () => {
    const log = { warn: vi.fn(), info: vi.fn() };
    const service = createPricingService({
      fetch: async () => response(),
      log,
    });
    await service.trusted();
    vi.setSystemTime(epoch + 15001);
    expect(service.display().status).toBe("stale");
    expect(service.display().observation?.receivedAt).toBe(epoch);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
      category: "freshness",
      ageMs: 15001,
    });
    await service.close();
    vi.setSystemTime(epoch);
    const oldTrade = createPricingService({
      fetch: async () =>
        response({ price: "1", time: new Date(epoch - 119000).toISOString() }),
    });
    await oldTrade.trusted();
    vi.setSystemTime(epoch + 1001);
    expect(oldTrade.display().status).toBe("stale");
    await oldTrade.close();
  });
  it.each(["fetch", "body"])(
    "bounds %s even when abort is ignored; releases flight and ignores late completion",
    async (phase) => {
      let release: ((value: ReturnType<typeof response>) => void) | undefined;
      let releaseBody: ((value: unknown) => void) | undefined;
      const pending = new Promise<ReturnType<typeof response>>((resolve) => {
        release = resolve;
      });
      const body = new Promise<unknown>((resolve) => {
        releaseBody = resolve;
      });
      const fetch = vi.fn().mockResolvedValue(response());
      if (phase === "fetch") fetch.mockReturnValueOnce(pending);
      else fetch.mockResolvedValueOnce({ ok: true, json: () => body });
      const log = { warn: vi.fn(), info: vi.fn() };
      const service = createPricingService({ fetch, log });
      const a = service.trusted();
      const b = service.trusted();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await a).toBeNull();
      expect(await b).toBeNull();
      expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
        category: "timeout",
        elapsedMs: 3000,
      });
      expect(await service.trusted()).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await service.trusted()).not.toBeNull();
      release?.(response({ price: "999", time: ticker.time }));
      releaseBody?.({ price: "999", time: ticker.time });
      await Promise.resolve();
      expect(service.display().observation?.price).toBe(ticker.price);
      await service.close();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("polls boundedly without overlap, aborts inflight and cleans up shutdown timers", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise<ReturnType<typeof response>>(() => {});
    });
    const service = createPricingService({ fetch });
    expect(fetch).not.toHaveBeenCalled();
    service.start();
    service.start();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await service.close();
    expect(signal?.aborted).toBe(true);
    expect(await service.trusted()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rate limits safe diagnostics, including malformed payload and body exception secrets", async () => {
    const secret = "SECRET_COOKIE Ada PRIVATE_PAYLOAD";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ price: secret, time: secret }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error(secret);
        },
      })
      .mockRejectedValue(new Error(secret));
    const log = { warn: vi.fn(), info: vi.fn() };
    const service = createPricingService({ fetch, log });
    for (let i = 0; i < 13; i++) {
      await service.trusted();
      vi.setSystemTime(epoch + (i + 1) * 5000);
    }
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.info).not.toHaveBeenCalled();
    const output = JSON.stringify(log.warn.mock.calls);
    expect(output).not.toMatch(/SECRET_COOKIE|Ada|PRIVATE_PAYLOAD/);
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
      jobId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      elapsedMs: 0,
      retryInMs: 5000,
    });
    await service.close();
  });
});
