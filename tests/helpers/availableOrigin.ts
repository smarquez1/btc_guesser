import { once } from 'node:events';
import { createServer } from 'node:net';

export async function availableOrigin() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Expected a local TCP listening address');
  }

  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });

  return origin;
}
