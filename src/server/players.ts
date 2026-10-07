import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { playerDiagnostics } from "./diagnostics.js";
import type { DisplayPricing, PriceObservation } from "./pricing.js";
import {
  createRateLimiter,
  playerCreationPolicy,
  type RateLimitPolicy,
} from "./rate-limit.js";

export interface PendingGuess {
  id: string;
  direction: "up" | "down";
  startingPrice: string;
  acceptedAt: number;
  eligibleAt: number;
}
export interface GuessResolution {
  result: "correct" | "incorrect";
  scoreDelta: 1 | -1;
  resolvedAt: number;
  observedPrice: string;
  observedAt: number;
}
export interface ResolvedGuess extends PendingGuess, GuessResolution {}
export interface DueGuess {
  playerId: string;
  guess: PendingGuess;
}
export interface PlayerRecord {
  playerId: string;
  displayName: string;
  sessionDigest: string;
  score: number;
  activeGuess?: PendingGuess;
  latestGuess?: ResolvedGuess;
}
export interface PlayerStore {
  create(player: PlayerRecord): Promise<void>;
  get(playerId: string): Promise<PlayerRecord | undefined>;
  accept(playerId: string, guess: PendingGuess): Promise<PlayerRecord>;
  due(now: number, limit: number): Promise<DueGuess[]>;
  resolve(playerId: string, guess: ResolvedGuess): Promise<PlayerRecord>;
}
export class ActiveGuessConflict extends Error {}
export class ObsoleteGuessConflict extends Error {}
class StorageUnavailable extends Error {}
export interface PlayerOptions {
  store?: PlayerStore;
  production?: boolean;
  now?: () => number;
  id?: () => string;
  token?: () => string;
  // T003 owns freshness/validation; null means no fresh trusted observation.
  price?: () => Promise<PriceObservation | null>;
  displayPricing?: () => DisplayPricing;
  // Bounds unauthenticated player creation; overridable for tests.
  creationLimit?: RateLimitPolicy;
  // Enables the creation limiter. Defaults to `production`: development traffic
  // all arrives from one loopback address, so a per-address limit there would be
  // effectively global and block normal play (including private windows).
  rateLimit?: boolean;
}
export function digestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function publicPlayer(player: PlayerRecord) {
  const guess = (value: PendingGuess | ResolvedGuess | undefined) => {
    if (!value) return null;
    const pending = {
      id: value.id,
      direction: value.direction,
      startingPrice: value.startingPrice,
      acceptedAt: value.acceptedAt,
      eligibleAt: value.eligibleAt,
    };
    if (!("result" in value)) return pending;
    return {
      ...pending,
      result: value.result,
      scoreDelta: value.scoreDelta,
      resolvedAt: value.resolvedAt,
      observedPrice: value.observedPrice,
      observedAt: value.observedAt,
    };
  };
  return {
    id: player.playerId,
    displayName: player.displayName,
    score: player.score,
    activeGuess: guess(player.activeGuess),
    latestGuess: guess(player.latestGuess),
  };
}
function singleField(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return undefined;
  const fields = Object.keys(body);
  return fields.length === 1 && fields[0] === key
    ? Reflect.get(body, key)
    : undefined;
}
// Fastify framework errors are duck-typed: they carry a string `code` and a
// numeric 4xx `statusCode`. Returns that status for recognized client errors.
function frameworkErrorStatus(error: unknown): number | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("FST_ERR_") &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
    return error.statusCode;
  return undefined;
}
function statusToErrorCode(status: number): string {
  return status === 400
    ? "invalid_body"
    : status === 413
      ? "payload_too_large"
      : status === 415
        ? "unsupported_media_type"
        : "invalid_request";
}
/**
 * Minimum wait between accepting a guess and allowing resolution, in
 * milliseconds. GUESS_MIN_WAIT_MS overrides the 60s rule only when it is a
 * positive integer string; any other value (including absent) falls back to
 * 60_000. Read at runtime so local tooling can shorten the window.
 */
export function guessMinWaitMs(): number {
  const configured = process.env.GUESS_MIN_WAIT_MS;
  if (configured !== undefined && /^[1-9]\d*$/.test(configured)) {
    const value = Number(configured);
    if (Number.isSafeInteger(value)) return value;
  }
  return 60_000;
}
export async function playerRoutes(
  app: FastifyInstance,
  options: PlayerOptions,
) {
  const {
    store,
    production = false,
    now = Date.now,
    id = randomUUID,
    token = () => randomBytes(32).toString("hex"),
    price = async () => null,
    displayPricing = () => ({ status: "unavailable", observation: null }),
    creationLimit = playerCreationPolicy,
    rateLimit = production,
  } = options;
  const creationLimiter = rateLimit
    ? createRateLimiter(creationLimit, now)
    : null;
  const state = (player: PlayerRecord) => ({
    ...publicPlayer(player),
    pricing: displayPricing(),
  });
  const diagnostics = playerDiagnostics(now);
  async function storageCall<T>(
    request: FastifyRequest,
    operation: "storage_read" | "storage_create" | "storage_accept",
    call: () => Promise<T>,
  ) {
    try {
      const result = await call();
      diagnostics.recovered(request, operation);
      return result;
    } catch (error) {
      if (error instanceof ActiveGuessConflict) {
        diagnostics.recovered(request, operation);
        throw error;
      }
      diagnostics.failed(request, operation, "persistence_failure");
      throw new StorageUnavailable();
    }
  }
  function unavailableStorage(request: FastifyRequest) {
    diagnostics.failed(request, "storage_read", "persistence_unconfigured");
    return { error: "persistence_unavailable" };
  }
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 500) diagnostics.recovered(request, "request");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ActiveGuessConflict)
      return reply.code(409).send({ error: "active_guess" });
    const status = frameworkErrorStatus(error);
    if (status !== undefined)
      return reply.code(status).send({ error: statusToErrorCode(status) });
    if (!(error instanceof StorageUnavailable))
      diagnostics.failed(request, "request", "request_failure");
    // Error objects/messages can contain private item or provider values.
    return reply.code(503).send({ error: "persistence_unavailable" });
  });
  async function authenticate(request: FastifyRequest) {
    const cookie = request.cookies.btc_player;
    if (!cookie || !store) return undefined;
    const match = /^([a-zA-Z0-9-]{1,64})\.([a-f0-9]{64})$/.exec(cookie);
    if (!match) return undefined;
    const player = await storageCall(request, "storage_read", () =>
      store.get(match[1]),
    );
    if (!player || !/^[a-f0-9]{64}$/.test(player.sessionDigest))
      return undefined;
    return timingSafeEqual(
      Buffer.from(player.sessionDigest, "hex"),
      Buffer.from(digestToken(match[2]), "hex"),
    )
      ? player
      : undefined;
  }
  app.post("/api/players", async (request, reply) => {
    const name = singleField(request.body, "displayName");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      return reply.code(400).send({ error: "invalid_display_name" });
    }
    if (!store) return reply.code(503).send(unavailableStorage(request));
    const existing = await authenticate(request);
    if (existing) return reply.code(200).send(state(existing));
    // Only a genuine new-player creation consumes the budget; a returning
    // session is never throttled. Production-only: development shares one
    // loopback address for every browser.
    if (creationLimiter && !creationLimiter.allow(request.ip)) {
      reply.header("Retry-After", String(creationLimiter.retryAfterSeconds()));
      return reply.code(429).send({ error: "too_many_requests" });
    }
    const credential = token();
    const player: PlayerRecord = {
      playerId: id(),
      displayName: name.trim(),
      score: 0,
      sessionDigest: digestToken(credential),
    };
    await storageCall(request, "storage_create", () => store.create(player));
    reply.setCookie("btc_player", `${player.playerId}.${credential}`, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/",
    });
    return reply.code(201).send(state(player));
  });
  app.get("/api/player", async (request, reply) => {
    if (!store) return reply.code(503).send(unavailableStorage(request));
    const player = await authenticate(request);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return state(player);
  });
  app.post("/api/guesses", async (request, reply) => {
    const direction = singleField(request.body, "direction");
    if (direction !== "up" && direction !== "down")
      return reply.code(400).send({ error: "invalid_direction" });
    if (!store) return reply.code(503).send(unavailableStorage(request));
    const player = await authenticate(request);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    if (player.activeGuess)
      return reply.code(409).send({ error: "active_guess" });
    let observation: Awaited<ReturnType<typeof price>>;
    try {
      observation = await price();
    } catch {
      diagnostics.failed(request, "price", "price_failure");
      return reply.code(503).send({ error: "price_unavailable" });
    }
    if (!observation) {
      diagnostics.failed(request, "price", "price_unavailable");
      return reply.code(503).send({ error: "price_unavailable" });
    }
    diagnostics.recovered(request, "price");
    // The minimum wait starts at server acceptance, not the cached observation's receipt time.
    const acceptedAt = now();
    const updated = await storageCall(request, "storage_accept", () =>
      store.accept(player.playerId, {
        id: id(),
        direction,
        startingPrice: observation.price,
        acceptedAt,
        eligibleAt: acceptedAt + guessMinWaitMs(),
      }),
    );
    return reply.code(201).send(state(updated));
  });
}
