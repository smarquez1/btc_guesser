import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status'],
            additionalProperties: false,
            properties: { status: { type: 'string', const: 'ok' } },
          },
        },
      },
    },
    async () => ({ status: 'ok' }),
  );
}
