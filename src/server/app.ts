import { extname } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import { type PlayerOptions, playerRoutes } from "./players.js";
import type { PricingService } from "./pricing.js";

export interface AppOptions extends PlayerOptions {
  logger?: FastifyServerOptions["logger"];
  staticDir?: string;
  pricingService?: (log: FastifyBaseLogger) => PricingService;
}

export function buildApp({
  logger = false,
  staticDir,
  pricingService,
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
  });
  app.register(cookie);
  if (pricingService) {
    const pricing = pricingService(app.log);
    players.price = pricing.trusted;
    players.displayPricing = pricing.display;
    app.addHook("onReady", async () => {
      pricing.start();
    });
    app.addHook("onClose", async () => {
      await pricing.close();
    });
  }
  app.register(playerRoutes, players);

  app.get("/api/health", async () => ({ status: "ok" }));

  if (staticDir) {
    app.register(fastifyStatic, { root: staticDir });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
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

    return reply.code(404).send({
      statusCode: 404,
      error: "Not Found",
      message: "Route not found",
    });
  });

  return app;
}
