import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { useGame } from '../src/hooks/useGame';
import { usePrice } from '../src/hooks/usePrice';
import { useCountdown } from '../src/hooks/useCountdown';
import { PriceDisplay } from '../src/components/PriceDisplay';
import type { Guess } from '../src/lib/api';

const player = { name: 'Steve', score: 0 };
const guess: Guess = { id: 'guess', status: 'pending', direction: 'up', startingPrice: 100, deadline: 60 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });

  return { promise, resolve };
}

async function mountHook<T>(t: TestContext, hook: () => T, strict = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(dom.window.document.getElementById('root') as HTMLElement);
  let value!: T;
  let unmounted = false;

  function Probe() {
    value = hook();

    return null;
  }

  async function unmount() {
    if (unmounted) {
      return;
    }

    await act(async () => root.unmount());
    unmounted = true;
  }

  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key]) {
        Object.defineProperty(globalThis, key, previous[key]);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)));

  async function rerender() {
    await act(async () => root.render(createElement(Probe)));
  }

  return { current: () => value, unmount, rerender };
}

async function advance(t: TestContext, milliseconds: number) {
  await act(async () => t.mock.timers.tick(milliseconds));
}

test('game submission rejects duplicates and discards an older polling response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldProfile = deferred<Response>();
  const submission = deferred<Response>();
  let profileReads = 0;
  let submissions = 0;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST') {
      submissions += 1;
      return submission.promise;
    }

    profileReads += 1;
    return profileReads === 1 ? Response.json(player) : oldProfile.promise;
  });
  const hook = await mountHook(t, useGame);
  assert.equal(hook.current().disabled, false);
  await advance(t, 3000);

  let first!: Promise<void>;
  await act(async () => {
    first = hook.current().submit('up');
    await hook.current().submit('down');
  });
  assert.equal(submissions, 1);
  assert.equal(hook.current().submitting, true);

  await act(async () => {
    submission.resolve(Response.json(guess, { status: 201 }));
    await first;
    oldProfile.resolve(Response.json({ name: 'Old profile', score: -1 }));
  });
  assert.equal(hook.current().guess?.id, 'guess');
  assert.equal(hook.current().player?.name, 'Steve');
  assert.equal(hook.current().pending, true);
  assert.equal(hook.current().submitting, false);
});

test('another tab can resolve a pending guess without leaving controls disabled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolvedElsewhere = false;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    if (String(path).includes('/guesses/')) {
      return Response.json(resolvedElsewhere ? { ...guess, status: 'resolved', correct: true } : guess);
    }

    return Response.json(resolvedElsewhere ? { ...player, score: 1 } : { ...player, pendingGuessId: 'guess' });
  });
  const hook = await mountHook(t, useGame);
  assert.equal(hook.current().pending, true);

  resolvedElsewhere = true;
  await advance(t, 3000);
  assert.equal(hook.current().guess?.status, 'resolved');
  assert.equal(hook.current().player?.score, 1);
  assert.equal(hook.current().disabled, false);

  await advance(t, 3000);
  assert.equal(hook.current().guess?.status, 'resolved');
});

test('an uncertain submission is recovered through the persisted pending ID', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let saved = false;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST') {
      saved = true;
      throw new Error('Connection lost after commit');
    }

    return Response.json(String(path).includes('/guesses/') ? guess : saved ? { ...player, pendingGuessId: 'guess' } : player);
  });
  const hook = await mountHook(t, useGame);

  await act(async () => hook.current().submit('up'));
  assert.equal(hook.current().syncing, true);
  assert.match(hook.current().error, /could not be confirmed/);

  await advance(t, 3000);
  assert.equal(hook.current().guess?.id, 'guess');
  assert.equal(hook.current().pending, true);
  assert.equal(hook.current().error, '');
});

test('Strict Mode cancels obsolete identity creation and cleanup stops polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let creations = 0;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST') {
      creations += 1;
      return Response.json(player, { status: 201 });
    }

    reads += 1;
    return Response.json({ error: 'Missing identity' }, { status: 401 });
  });
  const hook = await mountHook(t, useGame, true);
  assert.equal(creations, 1);
  assert.equal(hook.current().player?.name, 'Steve');
  await hook.unmount();
  const previousReads = reads;

  await advance(t, 30_000);
  assert.equal(reads, previousReads);
  assert.equal(creations, 1);
});

test('initial game errors retry successfully without creating a different identity', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls === 1 ? Response.json({ error: 'Storage unavailable' }, { status: 500 }) : Response.json(player);
  });
  const hook = await mountHook(t, useGame);
  assert.equal(hook.current().disabled, true);
  assert.equal(hook.current().error, 'Storage unavailable');

  await advance(t, 3000);
  assert.equal(hook.current().error, '');
  assert.equal(hook.current().disabled, false);
  assert.equal(calls, 2);
});

test('price polling retains the last price, avoids overlap, recovers, and stops on unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slowResponse = deferred<Response>();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 2) {
      throw new Error('Offline');
    }

    if (calls === 3) {
      return slowResponse.promise;
    }

    return Response.json({ price: 100, observedAt: 10, stale: false });
  });
  const hook = await mountHook(t, usePrice);
  await advance(t, 5000);
  assert.equal(hook.current().price?.price, 100);
  assert.match(hook.current().error, /unavailable/);

  await advance(t, 5000);
  await advance(t, 20_000);
  assert.equal(calls, 3);
  await act(async () => slowResponse.resolve(Response.json({ price: 101, observedAt: 20, stale: false })));
  assert.equal(hook.current().price?.price, 101);
  assert.equal(hook.current().error, '');
  await hook.unmount();

  await advance(t, 20_000);
  assert.equal(calls, 3);
});

test('countdown uses epoch seconds, reaches zero, and stops when no guess is pending', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100_000 });
  let deadline: number | undefined = 102;
  let renders = 0;
  const hook = await mountHook(t, () => {
    renders += 1;

    return useCountdown(deadline);
  });
  assert.equal(hook.current(), 2);
  await advance(t, 1000);
  assert.equal(hook.current(), 1);
  await advance(t, 5000);
  assert.equal(hook.current(), 0);

  deadline = undefined;
  await hook.rerender();
  const previousRenders = renders;
  await advance(t, 5000);
  assert.equal(hook.current(), 0);
  assert.equal(renders, previousRenders);
});

test('unmounting during a price request ignores its response and schedules no new poll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', async () => response.promise);
  const hook = await mountHook(t, usePrice);
  await hook.unmount();

  await act(async () => response.resolve(Response.json({ price: 100, observedAt: 10, stale: false })));
  await advance(t, 20_000);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(hook.current().price, null);
});

test('price result color clears for a newer observation or different price', () => {
  const result: Guess = { ...guess, status: 'resolved', correct: true, finalPrice: 101, finalObservedAt: 60 };
  const render = (price: number, observedAt: number, correct = true) => renderToStaticMarkup(createElement(PriceDisplay, {
    price: { price, observedAt, stale: false },
    result: { ...result, correct },
    unavailable: false,
  }));

  assert.match(render(101, 60), /text-green-700/);
  assert.match(render(101, 60, false), /text-red-700/);
  assert.doesNotMatch(render(101, 61), /text-green-700|text-red-700/);
  assert.doesNotMatch(render(102, 60), /text-green-700|text-red-700/);
});

test('resolution displays its own price before polling catches up, then newer prices are black', () => {
  const result: Guess = { ...guess, status: 'resolved', correct: true, finalPrice: 101, finalObservedAt: 60 };
  const render = (price: number, observedAt: number, correct = true) => renderToStaticMarkup(createElement(PriceDisplay, {
    price: { price, observedAt, stale: false },
    result: { ...result, correct },
    unavailable: false,
  }));

  const beforePoll = render(100, 59);
  assert.match(beforePoll, /\$101\.00/);
  assert.match(beforePoll, /text-green-700/);
  assert.doesNotMatch(beforePoll, /\$100\.00/);
  assert.match(render(100, 59, false), /text-red-700/);

  const nextPoll = render(102, 61);
  assert.match(nextPoll, /\$102\.00/);
  assert.match(nextPoll, /text-neutral-900/);
  assert.doesNotMatch(nextPoll, /text-green-700|text-red-700/);
});
