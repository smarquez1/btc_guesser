import { extname } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import type { PlayerOptions, PlayerStore } from "./domain/player.js";
import { playerRoutes } from "./player/routes.js";
import type { PriceObservation } from "./pricing/policy.js";
import type { PricingService } from "./pricing/service.js";
import type { Resolver } from "./resolution/resolver.js";

const notFoundBody = {
  statusCode: 404,
  error: "Not Found",
  message: "Route not found",
} as const;

export interface AppOptions extends PlayerOptions {
  logger?: FastifyServerOptions["logger"];
  staticDir?: string;
  pricingService?: (log: FastifyBaseLogger) => PricingService;
  resolverService?: (dependencies: {
    log: FastifyBaseLogger;
    store: PlayerStore;
    trusted: () => Promise<PriceObservation | null>;
  }) => Resolver;
}

export function buildApp({
  logger = false,
  staticDir,
  pricingService,
  resolverService,
  production = false,
  ...players
}: AppOptions = {}) {
  const app = Fastify({
    logger: logger
      ? {
          ...(typeof logger === "object" ? logger : {}),
          redact: ["req.headers.cookie", "res.headers.set-cookie"],
          // URLs, IPs and raw errors can contain private client/provider data.
          serializers: {
            req: () => ({}),
            res: (reply) => ({ statusCode: reply.statusCode }),
            err: () => ({
              type: "RequestFailure",
              message: "Sanitized request failure",
              stack: "",
            }),
          },
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    // Behind the hosting proxy, trust X-Forwarded-For so per-IP limits and logs
    // see the real client. Only enabled in production, where the proxy is the
    // sole ingress; development binds to loopback.
    trustProxy: production,
  });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });
  app.register(cookie);
  if (pricingService) {
    const pricing = pricingService(app.log);
    players.price = pricing.trusted;
    players.displayPricing = pricing.display;
    // Resolution needs both a store and trusted observations; offline builds skip it.
    const resolver =
      players.store && resolverService
        ? resolverService({
            log: app.log,
            store: players.store,
            trusted: pricing.trusted,
          })
        : undefined;
    app.addHook("onReady", async () => {
      pricing.start();
      resolver?.start();
    });
    app.addHook("onClose", async () => {
      await resolver?.close();
      await pricing.close();
    });
  }
  app.register(playerRoutes, { ...players, production });

  app.get("/api/health", async () => ({ status: "ok" }));

  if (staticDir) {
    app.register(fastifyStatic, { root: staticDir });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? "";
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const isAsset = pathname.startsWith("/assets/") || extname(pathname) !== "";
    const isNavigation = request.headers.accept?.includes("text/html");

    if (
      staticDir &&
      request.method === "GET" &&
      !isApi &&
      !isAsset &&
      isNavigation
    ) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send(notFoundBody);
  });

  return app;
}
