import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { createFatalHandler } from "./observability/fatal.js";
import {
  persistenceConfigError,
  timingConfigError,
} from "./observability/production-config.js";
import { runtimePersistence } from "./persistence/runtime.js";
import { guessMinWaitMs } from "./player/routes.js";
import { createPricingService } from "./pricing/service.js";
import { createResolver } from "./resolution/resolver.js";

const production =
  process.env.NODE_ENV === "production" ||
  import.meta.url.endsWith("/dist/server/index.js");
const persistence = runtimePersistence();
const persistenceError = persistenceConfigError(
  production,
  persistence !== undefined,
);
if (persistenceError) {
  console.error(persistenceError);
  process.exit(1);
}
const timingError = timingConfigError(production, guessMinWaitMs());
if (timingError) {
  console.error(timingError);
  process.exit(1);
}
const app = buildApp({
  production,
  store: persistence?.store,
  logger: true,
  pricingService: (log) => createPricingService({ log }),
  resolverService: (dependencies) => createResolver(dependencies),
  staticDir: production
    ? fileURLToPath(new URL("../client/", import.meta.url))
    : undefined,
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  } finally {
    // app.close() drains every onClose hook (resolver and pricing settle here)
    // before this final close of the persistence client.
    persistence?.close();
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const fatal = createFatalHandler({
  log: app.log,
  exit: (code) => process.exit(code),
});
process.on("uncaughtException", (error) =>
  fatal("uncaughtException", error.name),
);
process.on("unhandledRejection", (reason) =>
  fatal(
    "unhandledRejection",
    reason instanceof Error ? reason.name : "UnknownError",
  ),
);

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
