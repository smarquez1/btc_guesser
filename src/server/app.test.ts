import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let app: FastifyInstance | undefined;
let staticDir: string | undefined;

afterEach(async () => {
  await app?.close();
  if (staticDir) await rm(staticDir, { recursive: true, force: true });
  app = undefined;
  staticDir = undefined;
});

describe("application", () => {
  it("reports API health without a frontend build", async () => {
    app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns JSON 404s without static serving", async () => {
    app = buildApp();
    const response = await app.inject("/api/unknown");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "Not Found" });
  });

  describe("production frontend serving", () => {
    async function setup() {
      staticDir = await mkdtemp(join(tmpdir(), "btc-guesser-"));
      await mkdir(join(staticDir, "assets"));
      await writeFile(
        join(staticDir, "index.html"),
        "<!doctype html><h1>App shell</h1>",
      );
      await writeFile(
        join(staticDir, "assets", "app.js"),
        "console.info('fixture');",
      );
      app = buildApp({ staticDir });
      return app;
    }

    it("serves the index and built assets", async () => {
      const server = await setup();
      const index = await server.inject("/");
      expect(index.statusCode).toBe(200);
      expect(index.headers["content-type"]).toContain("text/html");
      expect(index.body).toContain("App shell");
      const asset = await server.inject("/assets/app.js");
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("javascript");
      expect(asset.body).toBe("console.info('fixture');");
    });

    it("serves the SPA shell for browser navigation", async () => {
      const server = await setup();
      const response = await server.inject({
        url: "/play/current?tab=score",
        headers: { accept: "text/html" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("App shell");
    });

    it.each(["/api", "/api/unknown", "/api/missing.js"])(
      "keeps %s separate from SPA fallback",
      async (url) => {
        const server = await setup();
        const response = await server.inject({
          url,
          headers: { accept: "text/html" },
        });
        expect(response.statusCode).toBe(404);
        expect(response.headers["content-type"]).toContain("application/json");
        expect(response.json()).toMatchObject({ error: "Not Found" });
      },
    );

    it.each(["/assets/missing.js", "/assets/missing", "/favicon.ico"])(
      "returns 404 for missing asset %s",
      async (url) => {
        const server = await setup();
        const response = await server.inject({
          url,
          headers: { accept: "text/html" },
        });
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain("App shell");
      },
    );

    it("does not return the SPA for non-GET or non-navigation requests", async () => {
      const server = await setup();
      const post = await server.inject({
        method: "POST",
        url: "/play/current",
        headers: { accept: "text/html" },
      });
      expect(post.statusCode).toBe(404);
      const json = await server.inject({
        url: "/play/current",
        headers: { accept: "application/json" },
      });
      expect(json.statusCode).toBe(404);
    });

    it("sets baseline security headers on health, API, asset, and 404 responses", async () => {
      const server = await setup();
      const responses = await Promise.all([
        server.inject("/api/health"),
        server.inject({
          method: "POST",
          url: "/api/players",
          payload: { displayName: "" },
        }),
        server.inject("/assets/app.js"),
        server.inject("/api/unknown"),
      ]);
      for (const response of responses) {
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["referrer-policy"]).toBe(
          "strict-origin-when-cross-origin",
        );
      }
    });
  });
});
