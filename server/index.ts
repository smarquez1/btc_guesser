import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

try {
  const config = loadConfig();
  const app = buildApp(config);

  if (process.env.NODE_ENV === 'production') {
    const clientRoot = resolve(import.meta.dirname, '../dist');
    await access(resolve(clientRoot, 'index.html'));

    app.register(fastifyStatic, { root: clientRoot });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      try {
        await app.close();
      } catch (error) {
        app.log.error(error);
        process.exitCode = 1;
      }
    });
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Backend startup failed',
  );
  process.exitCode = 1;
}
