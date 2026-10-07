import type { PriceObservation } from '../types/price.ts';

export async function fetchCoinbasePrice(
  fetcher: typeof fetch = fetch,
): Promise<PriceObservation> {
  const response = await fetcher(
    'https://api.exchange.coinbase.com/products/BTC-USD/ticker',
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`Coinbase request failed (${response.status})`);
  }

  const data: unknown = await response.json();

  if (
    !data ||
    typeof data !== 'object' ||
    !('trade_id' in data) ||
    typeof data.trade_id !== 'number' ||
    !Number.isSafeInteger(data.trade_id) ||
    data.trade_id <= 0 ||
    !('price' in data) ||
    typeof data.price !== 'string' ||
    !/^\d+(\.\d+)?$/.test(data.price) ||
    !('time' in data) ||
    typeof data.time !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(data.time)
  ) {
    throw new Error('Invalid Coinbase observation');
  }

  const price = Number(data.price);
  const observedAt = Math.floor(Date.parse(data.time) / 1000);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    observedAt > now
  ) {
    throw new Error('Invalid Coinbase observation');
  }

  return { tradeId: data.trade_id, price, observedAt };
}
