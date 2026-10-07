import Fastify, { type FastifyError } from 'fastify';
import { healthRoutes } from './routes/health.ts';

export function buildApp() {
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

  return app;
}
