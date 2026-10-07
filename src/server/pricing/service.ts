import { randomUUID } from "node:crypto";
import { createDiagnosticSlots } from "../observability/diagnostics.js";
import type { PricingLog } from "../observability/log.js";
import {
  type DisplayPricing,
  isFresh,
  type PriceObservation,
  pricingPolicy,
  tradeTimestamp,
  validPrice,
} from "./policy.js";

type Failure =
  | "timeout"
  | "transport"
  | "http"
  | "malformed"
  | "timestamp"
  | "freshness";
class ProviderFailure extends Error {
  constructor(readonly category: Failure) {
    super(category);
  }
}
export interface PricingOptions {
  fetch?: (
    url: string,
    options: { signal: AbortSignal },
  ) => Promise<Pick<Response, "ok" | "json">>;
  now?: () => number;
  log?: PricingLog;
}
export function createPricingService(options: PricingOptions = {}) {
  const fetchTicker = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let lastKnown: PriceObservation | null = null;
  let failed = false;
  let closed = false;
  let started = false;
  let retryAt = 0;
  const diagnostics = createDiagnosticSlots(now);
  let inflight: Promise<PriceObservation | null> | undefined;
  let cancel: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  function degrade(category: Failure, jobId: string, elapsedMs: number) {
    failed = true;
    diagnostics.degraded("degraded", () => {
      options.log?.warn(
        {
          category,
          jobId,
          elapsedMs,
          ageMs: lastKnown ? now() - lastKnown.receivedAt : null,
          retryInMs: Math.max(0, retryAt - now()),
        },
        "Pricing degraded",
      );
    });
  }
  function display(): DisplayPricing {
    if (lastKnown && !failed && !isFresh(lastKnown, now()))
      degrade("freshness", randomUUID(), 0);
    return {
      status: !lastKnown ? "unavailable" : failed || closed ? "stale" : "fresh",
      observation: lastKnown && { ...lastKnown },
    };
  }
  function createDeadline(timeoutMs: number) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new ProviderFailure("transport"));
      };
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderFailure("timeout"));
      }, timeoutMs);
    });
    return { controller, promise, clear: () => clearTimeout(timer) };
  }
  async function request(): Promise<PriceObservation | null> {
    const began = now();
    const jobId = randomUUID();
    const deadline = createDeadline(pricingPolicy.timeoutMs);
    const operation = async () => {
      const response = await fetchTicker(
        "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
        { signal: deadline.controller.signal },
      );
      if (!response.ok) throw new ProviderFailure("http");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderFailure("malformed");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new ProviderFailure("malformed");
      const price: unknown = Reflect.get(payload, "price");
      const time: unknown = Reflect.get(payload, "time");
      if (!validPrice(price)) throw new ProviderFailure("malformed");
      const tradeAt = tradeTimestamp(time);
      const receivedAt = now();
      if (
        tradeAt === null ||
        typeof time !== "string" ||
        receivedAt - tradeAt > pricingPolicy.tradeAgeMs ||
        tradeAt - receivedAt > pricingPolicy.futureMs
      )
        throw new ProviderFailure("timestamp");
      return { price, providerTradeAt: time, receivedAt };
    };
    try {
      const observation = await Promise.race([operation(), deadline.promise]);
      if (closed) return null;
      const recovering = failed;
      lastKnown = observation;
      failed = false;
      retryAt = 0;
      if (recovering)
        options.log?.info(
          {
            category: "recovery",
            jobId,
            elapsedMs: now() - began,
            ageMs: 0,
            retryInMs: 0,
          },
          "Pricing recovered",
        );
      return { ...observation };
    } catch (error) {
      if (!closed) {
        retryAt = now() + pricingPolicy.retryMs;
        degrade(
          error instanceof ProviderFailure ? error.category : "transport",
          jobId,
          now() - began,
        );
      }
      return null;
    } finally {
      deadline.clear();
      cancel = undefined;
    }
  }
  function trusted(): Promise<PriceObservation | null> {
    if (closed) return Promise.resolve(null);
    const current = display();
    if (
      current.status === "fresh" &&
      lastKnown &&
      now() - lastKnown.receivedAt < pricingPolicy.cacheMs
    )
      return Promise.resolve({ ...lastKnown });
    if (inflight) return inflight;
    if (now() < retryAt) return Promise.resolve(null);
    inflight = request().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }
  function start() {
    if (started || closed) return;
    started = true;
    const poll = async () => {
      await trusted();
      if (!closed)
        pollTimer = setTimeout(() => {
          void poll();
        }, pricingPolicy.pollMs);
    };
    void poll();
  }
  async function close() {
    closed = true;
    clearTimeout(pollTimer);
    cancel?.();
    await inflight;
  }
  return { trusted, display, start, close };
}
export type PricingService = ReturnType<typeof createPricingService>;
