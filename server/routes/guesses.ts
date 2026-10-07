import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.ts';
import { guessResponse } from '../schemas/guess.ts';
import { playerErrorResponse } from '../schemas/player.ts';
import type { guessService } from '../services/guesses.ts';
import type { playerService } from '../services/players.ts';

export const guessRoutes: FastifyPluginAsync<{
  config: Config;
  players: ReturnType<typeof playerService>;
  guesses: ReturnType<typeof guessService>;
}> = async (app, { config, players, guesses }) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post<{ Body: { direction: 'up' | 'down' } }>('/api/guesses', {
    schema: { response: { 201: guessResponse, '4xx': playerErrorResponse, 503: playerErrorResponse } },
  }, async (request, reply) => {
    if ((request.headers.origin && request.headers.origin !== config.appOrigin) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }

    const body = request.body;

    // Validate explicitly: Fastify's default schema handling strips extra fields.
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || (body.direction !== 'up' && body.direction !== 'down')) {
      return reply.code(400).send({ error: 'Provide only direction: up or down' });
    }

    const player = await players.find(request.cookies.btc_player);

    if (!player) {
      return reply.code(401).send({ error: 'Invalid or missing player identity' });
    }

    if (player.pendingGuessId) {
      return reply.code(409).send({ error: 'A guess is already pending' });
    }

    const result = await guesses.submit(player.id, body.direction);

    if (result.outcome === 'unavailable') {
      reply.header('Retry-After', 5);

      return reply.code(503).send({ error: 'Fresh BTC price unavailable' });
    }

    if (result.outcome === 'conflict') {
      return reply.code(409).send({ error: 'A guess is already pending' });
    }

    return reply.code(201).send(result.guess);
  });

  app.get<{ Params: { id: string } }>('/api/guesses/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } },
      },
      response: { 200: guessResponse, '4xx': playerErrorResponse },
    },
  }, async (request, reply) => {
    const player = await players.find(request.cookies.btc_player);

    if (!player) {
      return reply.code(401).send({ error: 'Invalid or missing player identity' });
    }

    const guess = await guesses.get(player.id, request.params.id);

    if (!guess) {
      return reply.code(404).send({ error: 'Guess not found' });
    }

    return guess;
  });
};
