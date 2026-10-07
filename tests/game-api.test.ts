import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, request } from '../src/lib/api';
import { loadGame } from '../src/lib/gameApi';

const player = { name: 'Steve', score: 0 };
const pending = { id: 'guess', status: 'pending', direction: 'up', startingPrice: 100, deadline: 60 };
const resolved = { ...pending, status: 'resolved', correct: true, finalPrice: 101 };

test('API requests preserve cookies, avoid caching, and send only supplied input', async (t) => {
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    calls.push({ path: String(path), options });

    return Response.json(player);
  });

  assert.deepEqual(await request('/players/me'), player);
  await request('/guesses', { direction: 'up' });
  assert.equal(calls[0].path, '/api/players/me');
  assert.equal(calls[0].options?.method, 'GET');
  assert.equal(calls[0].options?.credentials, 'same-origin');
  assert.equal(calls[0].options?.cache, 'no-store');
  assert.equal(calls[1].options?.method, 'POST');
  assert.equal(calls[1].options?.body, '{"direction":"up"}');
});

test('API failures retain the server status and safe message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'A guess is already pending' }, { status: 409 }));

  await assert.rejects(request('/guesses', { direction: 'up' }), (cause) =>
    cause instanceof ApiError && cause.status === 409 && cause.message === 'A guess is already pending',
  );
});

test('existing player reads preserve a displayed result without creating an identity', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(player));

  const snapshot = await loadGame(undefined, () => false);

  assert.deepEqual(snapshot?.player, player);
  assert.equal(snapshot?.guess, undefined);
  assert.equal(fetch.mock.callCount(), 1);
});

test('invalid identity creation retries once and clears the previous player guess', async (t) => {
  const responses = [
    Response.json({ error: 'Missing identity' }, { status: 401 }),
    Response.json({ error: 'Invalid cookie' }, { status: 401 }),
    Response.json(player, { status: 201 }),
  ];
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    paths.push(String(path));

    return responses.shift() as Response;
  });

  const snapshot = await loadGame('previous-player-guess', () => false);

  assert.equal(snapshot?.guess, null);
  assert.equal(snapshot?.pendingGuessId, undefined);
  assert.deepEqual(paths, ['/api/players/me', '/api/players', '/api/players']);
});

test('cancellation after a missing identity prevents player creation', async (t) => {
  let cancelled = false;
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    cancelled = true;

    return Response.json({ error: 'Missing identity' }, { status: 401 });
  });

  await assert.rejects(loadGame(undefined, () => cancelled), ApiError);
  assert.equal(fetch.mock.callCount(), 1);
});

test('a guess resolved in another tab is recovered and paired with the latest score', async (t) => {
  const responses = [player, resolved, { ...player, score: 1 }];
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    paths.push(String(path));

    return Response.json(responses.shift());
  });

  const snapshot = await loadGame('guess', () => false);

  assert.equal(snapshot?.guess?.status, 'resolved');
  assert.equal(snapshot?.player.score, 1);
  assert.equal(snapshot?.pendingGuessId, undefined);
  assert.deepEqual(paths, ['/api/players/me', '/api/guesses/guess', '/api/players/me']);
});

test('expired result evidence clears the UI only when no pending ID remains', async (t) => {
  for (const pendingGuessId of [undefined, 'guess']) {
    const fetch = t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
      return String(path).endsWith('/players/me')
        ? Response.json({ ...player, pendingGuessId })
        : Response.json({ error: 'Guess not found' }, { status: 404 });
    });

    if (pendingGuessId) {
      await assert.rejects(loadGame('guess', () => false), ApiError);
    } else {
      assert.equal((await loadGame('guess', () => false))?.guess, null);
    }

    fetch.mock.restore();
  }
});

test('stale guess responses are discarded before a follow-up profile read', async (t) => {
  let cancelled = false;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path).endsWith('/players/me')) {
      return Response.json({ ...player, pendingGuessId: 'guess' });
    }

    cancelled = true;
    return Response.json(resolved);
  });

  assert.equal(await loadGame(undefined, () => cancelled), null);
  assert.equal(fetch.mock.callCount(), 2);
});

test('profile failures propagate without silently creating another player', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Storage unavailable' }, { status: 500 }));

  await assert.rejects(loadGame(undefined, () => false), ApiError);
  assert.equal(fetch.mock.callCount(), 1);
});
