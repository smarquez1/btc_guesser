import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../server/app.ts';
import { fetchCoinbasePrice } from '../server/lib/coinbase.ts';
import { priceRoutes } from '../server/routes/prices.ts';
import { priceService } from '../server/services/prices.ts';
import type { CachedPrice } from '../server/types/price.ts';

const now = 1800000000;
const observation = { tradeId: 1, price: 65000.25, observedAt: now };
const publicObservation = { price: observation.price, observedAt: observation.observedAt };
const cached: CachedPrice = {
  symbol: 'BTC-USD', ...observation, freshUntil: now + 5, expiresAt: now + 3600,
};

function repository(initial?: CachedPrice) {
  let value = initial;

  return {
    get: async () => value,
    save: async (candidate: CachedPrice): Promise<CachedPrice | undefined> => {
      value = candidate;

      return value;
    },
  };
}

function unavailable(): never {
  throw new Error('private upstream failure');
}

test('Coinbase client preserves the source time as epoch seconds', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.exchange.coinbase.com/products/BTC-USD/ticker');
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(options?.cache, 'no-store');

    return Response.json({ trade_id: 1, price: '65000.25', time: '2027-01-15T08:00:00.999Z' });
  };

  assert.deepEqual(await fetchCoinbasePrice(fetcher), observation);
});

test('Coinbase client rejects malformed, nonpositive, and future observations', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);

  for (const data of [
    null, {}, { trade_id: 1, price: 65000, time: '2027-01-15T08:00:00Z' },
    ...['0', '-1', 'NaN', 'Infinity', '1e6', '', '9'.repeat(400)].map((price) => ({
      trade_id: 1, price, time: '2027-01-15T08:00:00Z',
    })),
    ...[undefined, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((trade_id) => ({
      trade_id, price: '65000', time: '2027-01-15T08:00:00Z',
    })),
    { trade_id: 1, price: '65000', time: 'invalid' },
    { trade_id: 1, price: '65000', time: '2027-01-15T08:00:01Z' },
  ]) {
    await assert.rejects(fetchCoinbasePrice(async () => Response.json(data)), /Invalid Coinbase/);
  }
});

test('Coinbase HTTP, JSON, network, and timeout failures reject', async () => {
  await assert.rejects(fetchCoinbasePrice(async () => new Response('', { status: 429 })), /429/);
  await assert.rejects(fetchCoinbasePrice(async () => new Response('not json')));
  await assert.rejects(fetchCoinbasePrice(async () => { throw new Error('network'); }), /network/);
  await assert.rejects(fetchCoinbasePrice(async () => {
    throw new DOMException('request timed out', 'TimeoutError');
  }), { name: 'TimeoutError' });
});

test('fresh cache reads preserve observedAt without calling Coinbase or writing', async (t) => {
  t.mock.method(Date, 'now', () => (now + 4) * 1000);
  const store = repository(cached);
  store.save = async () => { throw new Error('unexpected write'); };
  let fetches = 0;
  const service = priceService(store, async () => {
    fetches++;

    return unavailable();
  });

  assert.deepEqual(await service.get(), { symbol: 'BTC-USD', ...publicObservation, stale: false });
  assert.equal(fetches, 0);
});

test('cache miss persists freshness and TTL separately from observation time', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const store = repository();
  const service = priceService(store, async () => observation);

  assert.deepEqual(await service.get(), { symbol: 'BTC-USD', ...publicObservation, stale: false });
  assert.deepEqual(await store.get(), cached);
});

test('freshness expires at the exact boundary and refreshes from Coinbase', async (t) => {
  t.mock.method(Date, 'now', () => (now + 5) * 1000);
  const service = priceService(repository(cached), async () => ({ tradeId: 2, price: 65001, observedAt: now + 5 }));

  assert.deepEqual(await service.get(), {
    symbol: 'BTC-USD', price: 65001, observedAt: now + 5, stale: false,
  });
});

test('Coinbase failure returns stale data without refreshing its timestamps', async (t) => {
  t.mock.method(Date, 'now', () => (now + 5) * 1000);
  const store = repository(cached);
  const service = priceService(store, async () => unavailable());

  assert.deepEqual(await service.get(), { symbol: 'BTC-USD', ...publicObservation, stale: true });
  assert.deepEqual(await store.get(), cached);
});

test('expired cache records are unusable even when TTL has not removed them', async (t) => {
  t.mock.method(Date, 'now', () => (now + 3600) * 1000);
  const store = repository(cached);
  const service = priceService(store, async () => unavailable());

  assert.equal(await service.get(), undefined);
  assert.deepEqual(await store.get(), cached);
});

test('missing cache plus Coinbase failure has no available observation', async () => {
  const service = priceService(repository(), async () => unavailable());

  assert.equal(await service.get(), undefined);
});

test('fallback checks expiry again after a slow upstream request', async (t) => {
  let clock = now + 3599;
  t.mock.method(Date, 'now', () => clock * 1000);
  const service = priceService(repository(cached), async () => {
    clock++;

    return unavailable();
  });

  assert.equal(await service.get(), undefined);
});

test('old Coinbase observations are never retimestamped or persisted after expiry', async (t) => {
  t.mock.method(Date, 'now', () => (now + 3600) * 1000);
  const store = repository();
  store.save = async () => { throw new Error('unexpected write'); };
  const service = priceService(store, async () => observation);

  assert.equal(await service.get(), undefined);
});

test('refresh returns the repository winner when another request stored a newer observation', async (t) => {
  t.mock.method(Date, 'now', () => (now + 6) * 1000);
  const store = repository(cached);
  store.save = async () => ({ ...cached, tradeId: 3, price: 66000, observedAt: now + 6, freshUntil: now + 11 });
  const service = priceService(store, async () => ({ tradeId: 2, price: 65500, observedAt: now + 5 }));

  assert.deepEqual(await service.get(), {
    symbol: 'BTC-USD', price: 66000, observedAt: now + 6, stale: false,
  });
});

test('DynamoDB read and write failures propagate instead of masquerading as Coinbase outages', async (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  const store = repository();
  store.get = async () => { throw new Error('database read'); };
  const service = priceService(store, async () => observation);

  await assert.rejects(service.get(), /database read/);
  store.get = async () => undefined;
  store.save = async () => { throw new Error('database write'); };
  await assert.rejects(service.get(), /database write/);
});

test('price route exposes stale observation state without internal trade IDs and disables HTTP caching', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const prices = { get: async () => ({ symbol: 'BTC-USD' as const, ...observation, stale: true }) };
  app.register(priceRoutes, { prices });
  const available = await app.inject('/api/price');

  assert.equal(available.statusCode, 200);
  assert.deepEqual(available.json(), { symbol: 'BTC-USD', ...publicObservation, stale: true });
  assert.equal(available.headers['cache-control'], 'no-store');
});

test('price route returns safe 503 with a retry hint when no observation is available', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.register(priceRoutes, { prices: { get: async () => undefined } });
  const response = await app.inject('/api/price');

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'BTC price unavailable' });
  assert.equal(response.headers['retry-after'], '5');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('price route hides database failure details', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.register(priceRoutes, { prices: { get: async () => { throw new Error('private database details'); } } });
  const response = await app.inject('/api/price');

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal server error' });
});


test('unchanged ticker refreshes freshness without changing observation time or retention', async (t) => {
  let clock = now + 20;
  t.mock.method(Date, 'now', () => clock * 1000);
  const store = repository(cached);
  let fetches = 0;
  const service = priceService(store, async () => {
    fetches++;
    clock += 2;

    return observation;
  });
  const refreshed = await service.get();

  assert.deepEqual(refreshed, { symbol: 'BTC-USD', ...publicObservation, stale: false });
  assert.deepEqual(await store.get(), { ...cached, freshUntil: now + 27 });
  clock = now + 26;
  assert.deepEqual(await service.get(), refreshed);
  assert.equal(fetches, 1);
});

test('failed upstream fetch uses a concurrent cache refresh without changing its timestamp', async (t) => {
  t.mock.method(Date, 'now', () => (now + 5) * 1000);
  const store = repository(cached);
  const service = priceService(store, async () => {
    await store.save({
      ...cached, tradeId: 2, price: 66000, observedAt: now + 4, freshUntil: now + 10,
    });

    return unavailable();
  });

  assert.deepEqual(await service.get(), {
    symbol: 'BTC-USD', price: 66000, observedAt: now + 4, stale: false,
  });
});
