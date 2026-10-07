import type { priceRepository } from '../repositories/prices.ts';
import type { CachedPrice, PriceObservation, PriceState } from '../types/price.ts';

const freshnessSeconds = 5;
const retentionSeconds = 3600;

function availablePrice(cached: CachedPrice | undefined): PriceState | undefined {
  const now = Math.floor(Date.now() / 1000);

  if (!cached || cached.expiresAt <= now || cached.observedAt > now) {
    return undefined;
  }

  return {
    symbol: cached.symbol,
    price: cached.price,
    observedAt: cached.observedAt,
    stale: cached.freshUntil <= now,
  };
}

export function priceService(
  repository: ReturnType<typeof priceRepository>,
  fetchObservation: () => Promise<PriceObservation>,
) {
  return {
    async get(): Promise<PriceState | undefined> {
      const cached = availablePrice(await repository.get());

      if (cached && !cached.stale) return cached;

      let observation: PriceObservation;

      try {
        observation = await fetchObservation();
      } catch {
        // Reread in case another process refreshed the price during this request.
        return availablePrice(await repository.get());
      }

      const candidate: CachedPrice = {
        symbol: 'BTC-USD',
        ...observation,
        freshUntil: Math.floor(Date.now() / 1000) + freshnessSeconds,
        expiresAt: observation.observedAt + retentionSeconds,
      };

      if (!availablePrice(candidate)) {
        return availablePrice(await repository.get());
      }

      return availablePrice(await repository.save(candidate));
    },
  };
}
