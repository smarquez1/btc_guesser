import type { Guess, Price } from '../lib/api';
import { dollars } from '../lib/currency';

interface PriceDisplayProps {
  price: Price | null;
  result: Guess | null;
  unavailable: boolean;
}

export function PriceDisplay({ price, result, unavailable }: PriceDisplayProps) {
  // Resolution can observe a newer price before the independent price poll does.
  let displayedPrice = price;

  if (result?.finalPrice !== undefined && result.finalObservedAt !== undefined &&
    (!price || price.observedAt < result.finalObservedAt)) {
    displayedPrice = {
      price: result.finalPrice,
      observedAt: result.finalObservedAt,
      stale: price?.stale ?? false,
    };
  }

  const showResultColor = result && displayedPrice && result.finalObservedAt !== undefined &&
    displayedPrice.observedAt <= result.finalObservedAt && displayedPrice.price === result.finalPrice;
  const color = showResultColor
    ? result.correct ? 'text-green-700' : 'text-red-700'
    : 'text-neutral-900';

  return (
    <section aria-labelledby="price-label">
      <h1 id="price-label" className="mb-4 text-xs tracking-widest text-neutral-600">BITCOIN / USD</h1>
      <p className={`text-6xl tracking-tight tabular-nums ${color}`}>
        {displayedPrice ? dollars.format(displayedPrice.price) : '—'}
      </p>
      <p className="mt-4 mb-9 text-xs text-neutral-600">
        {displayedPrice ? `Latest observation · ${new Date(displayedPrice.observedAt * 1000).toLocaleTimeString()}${displayedPrice.stale || unavailable ? ' · Last available price' : ''}` : 'Loading the latest price…'}
      </p>
    </section>
  );
}
