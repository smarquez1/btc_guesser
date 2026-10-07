import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from './config.ts';
import { fetchCoinbasePrice } from './lib/coinbase.ts';
import { priceRepository } from './repositories/prices.ts';
import { priceRoutes } from './routes/prices.ts';
import { priceService } from './services/prices.ts';
import { createDynamoDB } from './lib/dynamodb.ts';
import { playerRepository } from './repositories/players.ts';
import { playerRoutes } from './routes/players.ts';
import { playerService } from './services/players.ts';
import { guessRepository } from './repositories/guesses.ts';
import { guessRoutes } from './routes/guesses.ts';
import { guessService } from './services/guesses.ts';
import { healthRoutes } from './routes/health.ts';

export function buildApp(config?: Config, fetchPrice = fetchCoinbasePrice) {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Invalid request' });
    }

    request.log.error(error);
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;

    return reply.code(status).send({
      error: status === 500 ? 'Internal server error' : 'Request failed',
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Not found' }),
  );

  app.register(healthRoutes);

  if (config) {
    const { client, documentClient } = createDynamoDB(config);
    const players = playerService(playerRepository(documentClient, config.tableName));
    app.addHook('onClose', async () => client.destroy());
    app.register(cookie);
    app.register(playerRoutes, { config, players });

    const prices = priceService(
      priceRepository(documentClient, config.tableName),
      fetchPrice,
    );
    app.register(priceRoutes, { prices });

    const guesses = guessService(guessRepository(documentClient, config.tableName), prices);
    app.register(guessRoutes, { config, players, guesses });
  }

  return app;
}
