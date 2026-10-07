import type { FastifyPluginAsync } from 'fastify';
import { priceResponse } from '../schemas/price.ts';
import type { priceService } from '../services/prices.ts';

export const priceRoutes: FastifyPluginAsync<{
  prices: ReturnType<typeof priceService>;
}> = async (app, { prices }) => {
  app.get(
    '/api/price',
    {
      schema: {
        response: {
          200: priceResponse,
          503: {
            type: 'object',
            required: ['error'],
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const price = await prices.get();

      if (!price) {
        reply.header('Retry-After', 5);

        return reply.code(503).send({ error: 'BTC price unavailable' });
      }

      return price;
    },
  );
};
