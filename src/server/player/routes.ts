import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ActiveGuessConflict,
  type PlayerOptions,
  type PlayerRecord,
} from "../domain/player.js";
import { playerDiagnostics } from "../observability/diagnostics.js";
import {
  createRateLimiter,
  playerCreationPolicy,
} from "../observability/throttle.js";
import {
  digestToken,
  matchesSessionDigest,
  parsePlayerCookie,
} from "./auth.js";
import { publicPlayer } from "./presenter.js";
import {
  frameworkErrorStatus,
  StorageUnavailable,
  statusToErrorCode,
} from "./request-errors.js";

// Instance-wide creation throttle key: a single bucket for the whole app, so the
// server never reads a client address. It bounds one instance's write
// amplification, not per-client fairness.
const CREATION_RATE_LIMIT_KEY = "instance";

function singleField(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return undefined;
  const fields = Object.keys(body);
  return fields.length === 1 && fields[0] === key
    ? Reflect.get(body, key)
    : undefined;
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
    const session = parsePlayerCookie(request.cookies.btc_player);
    if (!session || !store) return undefined;
    const player = await storageCall(request, "storage_read", () =>
      store.get(session.playerId),
    );
    if (
      !player ||
      !matchesSessionDigest(player.sessionDigest, session.credential)
    )
      return undefined;
    return player;
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
    // session is served before this check and is never throttled. The bucket is
    // instance-wide and reads no client address; enabled in production only.
    if (creationLimiter && !creationLimiter.allow(CREATION_RATE_LIMIT_KEY)) {
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
