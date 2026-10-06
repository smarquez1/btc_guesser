import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { runtimePersistence } from "./dynamodb.js";

const production =
  process.env.NODE_ENV === "production" ||
  import.meta.url.endsWith("/dist/server/index.js");
const persistence = runtimePersistence();
const app = buildApp({
  production,
  store: persistence?.store,
  logger: true,
  staticDir: production
    ? fileURLToPath(new URL("../client/", import.meta.url))
    : undefined,
});
app.addHook("onClose", async () => {
  persistence?.close();
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
