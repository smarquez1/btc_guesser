import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../server/app.ts';

test('health endpoint works without DynamoDB or a listening socket', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('unknown routes return a safe JSON 404', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject('/api/unknown');

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'Not found' });
});

test('schema failures return 400 without exposing validation internals', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.post(
    '/validation-check',
    {
      schema: {
        body: {
          type: 'object',
          required: ['direction'],
          properties: { direction: { type: 'string', enum: ['up', 'down'] } },
        },
      },
    },
    async () => ({ accepted: true }),
  );

  const response = await app.inject({
    method: 'POST',
    url: '/validation-check',
    payload: { direction: 'sideways' },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'Invalid request' });
});

test('unexpected errors hide internal details', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get('/error-check', async () => {
    throw new Error('private database details');
  });

  const response = await app.inject('/error-check');

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal server error' });
});

test('expected HTTP errors preserve their status without leaking details', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get('/conflict-check', async () => {
    throw Object.assign(new Error('private conflict details'), {
      statusCode: 409,
    });
  });

  const response = await app.inject('/conflict-check');

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'Request failed' });
});
