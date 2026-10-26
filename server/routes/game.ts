import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.ts';
import { clearPlayerCookie, playerCookieName, setPlayerCookie } from '../lib/player-cookie.ts';
import { pageAssets } from '../lib/assets.ts';
import { formatUsd, gameViewService } from '../services/game-view.ts';
import type { guessService } from '../services/guesses.ts';
import type { playerService } from '../services/players.ts';
import type { priceService } from '../services/prices.ts';

const playerIdPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const gameRoutes: FastifyPluginAsync<{
  config: Config;
  players: ReturnType<typeof playerService>;
  prices: ReturnType<typeof priceService>;
  guesses: ReturnType<typeof guessService>;
}> = async (app, { config, players, prices, guesses }) => {
  const game = gameViewService(players, prices, guesses);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/game', async (request, reply) => {
    const player = await players.find(request.cookies[playerCookieName]);

    if (!player && request.cookies[playerCookieName]) clearPlayerCookie(reply);

    const view = player ? await game.load(player) : null;
    const assets = await pageAssets(config);
    const html = await reply.viewAsync('page.ejs', {
      assets,
      view,
      formatUsd,
      needsSession: !player,
    });

    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.post('/api/ui/session', async (request, reply) => {
    if ((request.headers.origin && request.headers.origin !== config.appOrigin) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Origin not allowed' }));
    }

    if (request.body !== undefined && request.body !== null &&
      (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
      return reply.code(400).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Session setup accepts no fields' }));
    }

    const identity = request.cookies[playerCookieName];
    let player = identity ? await players.find(identity) : undefined;

    if (!player) {
      if (identity) clearPlayerCookie(reply);

      player = await players.create();
    }

    setPlayerCookie(reply, config, player.id);
    const view = await game.load(player);
    const html = await reply.viewAsync('game.ejs', { view, formatUsd });

    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get<{ Querystring: { guessId?: string } }>('/api/ui/game', {
    schema: {
      querystring: {
        type: 'object',
        properties: { guessId: { type: 'string', pattern: playerIdPattern } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const player = await players.find(request.cookies[playerCookieName]);

    if (!player) {
      clearPlayerCookie(reply);

      return reply.code(401).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Player session expired' }));
    }

    const view = await game.load(player, request.query.guessId);
    const html = await reply.viewAsync('game.ejs', { view, formatUsd });

    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.post<{ Querystring: { guessId?: string } }>('/api/ui/guesses', {
    schema: {
      querystring: {
        type: 'object',
        properties: { guessId: { type: 'string', pattern: playerIdPattern } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if ((request.headers.origin && request.headers.origin !== config.appOrigin) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Origin not allowed' }));
    }

    const player = await players.find(request.cookies[playerCookieName]);

    if (!player) {
      clearPlayerCookie(reply);

      return reply.code(401).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Player session expired' }));
    }

    const body = request.body;

    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !('direction' in body) ||
      (body.direction !== 'up' && body.direction !== 'down')) {
      return reply.code(400).type('text/html; charset=utf-8')
        .send(await reply.viewAsync('game-error.ejs', { message: 'Choose higher or lower to submit a guess' }));
    }

    const result = await guesses.submit(player.id, body.direction);
    let notice: string | undefined;

    if (result.outcome === 'unavailable') {
      notice = 'Fresh BTC price unavailable. Waiting for a current price…';
    } else if (result.outcome === 'conflict') {
      notice = 'A guess is already pending. Your current guess is shown above.';
    }

    const currentPlayer = await players.find(player.id);

    if (!currentPlayer) {
      throw new Error('The player disappeared after guess submission');
    }

    const view = await game.load(currentPlayer, request.query.guessId);
    view.notice = notice;
    const html = await reply.viewAsync('game.ejs', { view, formatUsd });

    return reply.type('text/html; charset=utf-8').send(html);
  });
};
