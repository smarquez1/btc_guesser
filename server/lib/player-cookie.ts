import type { FastifyReply } from 'fastify';
import type { Config } from '../config.ts';

export const playerCookieName = 'btc_player';

export function setPlayerCookie(reply: FastifyReply, config: Config, identity: string) {
  reply.setCookie(playerCookieName, identity, {
    path: '/api',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: 31536000,
  });
}

export function clearPlayerCookie(reply: FastifyReply) {
  reply.clearCookie(playerCookieName, { path: '/api' });
}
