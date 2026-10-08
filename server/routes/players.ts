import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.ts';
import { playerErrorResponse, playerResponse } from '../schemas/player.ts';
import type { playerService } from '../services/players.ts';

export const playerRoutes: FastifyPluginAsync<{
  config: Config;
  players: ReturnType<typeof playerService>;
}> = async (app, { config, players }) => {
  const cookieName = 'btc_player';
  const cookieOptions = {
    path: '/api',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.cookieSecure,
    maxAge: 31536000,
  };

  app.get('/api/players/me', {
    schema: { response: { 200: playerResponse, '4xx': playerErrorResponse } },
  }, async (request, reply) => {
    const player = await players.find(request.cookies[cookieName]);

    if (!player) {
      reply.clearCookie(cookieName, { path: '/api' });

      return reply.code(401).send({ error: 'Invalid or missing player identity' });
    }

    return player;
  });

  app.post('/api/players', {
    schema: { response: { 200: playerResponse, 201: playerResponse, '4xx': playerErrorResponse } },
  }, async (request, reply) => {
    const origin = request.headers.origin;

    if ((origin && origin !== config.appOrigin) || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }

    if (request.body !== undefined && request.body !== null &&
      (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
      return reply.code(400).send({ error: 'Player creation accepts no fields' });
    }

    const identity = request.cookies[cookieName];

    if (identity !== undefined) {
      const player = await players.find(identity);

      if (!player) {
        reply.clearCookie(cookieName, { path: '/api' });

        return reply.code(401).send({ error: 'Invalid player identity' });
      }

      reply.setCookie(cookieName, identity, cookieOptions);

      return player;
    }

    const player = await players.create();

    reply.setCookie(cookieName, player.id, cookieOptions);

    return reply.code(201).send(player);
  });
};
