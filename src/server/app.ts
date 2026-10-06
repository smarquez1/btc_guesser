import { extname } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

export interface AppOptions {
  logger?: boolean;
  staticDir?: string;
}

export function buildApp({ logger = false, staticDir }: AppOptions = {}) {
  const app = Fastify({ logger });

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
