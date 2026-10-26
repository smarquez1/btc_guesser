<script lang="ts">
  import type { Guess, Price } from '../lib/api';
  import { dollars } from '../lib/currency';

  interface Props {
    price: Price | null;
    result: Guess | null;
    unavailable: boolean;
  }

  let { price, result, unavailable }: Props = $props();

  // Resolution can observe a newer price before the independent price poll does.
  const displayedPrice = $derived.by(() => {
    if (
      result?.finalPrice !== undefined &&
      result.finalObservedAt !== undefined &&
      (!price || price.observedAt < result.finalObservedAt)
    ) {
      return {
        price: result.finalPrice,
        observedAt: result.finalObservedAt,
        stale: price?.stale ?? false,
      };
    }

    return price;
  });

  const showResultColor = $derived(
    Boolean(
      result &&
        displayedPrice &&
        result.finalObservedAt !== undefined &&
        displayedPrice.observedAt <= result.finalObservedAt &&
        displayedPrice.price === result.finalPrice,
    ),
  );
  const color = $derived(
    showResultColor
      ? result?.correct
        ? 'text-green-700'
        : 'text-red-700'
      : 'text-neutral-900',
  );
</script>

<section aria-labelledby="price-label">
  <h1 id="price-label" class="mb-4 text-xs tracking-widest text-neutral-600">
    BITCOIN / USD
  </h1>
  <p class="text-6xl tracking-tight tabular-nums {color}">
    {displayedPrice ? dollars.format(displayedPrice.price) : '—'}
  </p>
  <p class="mt-4 mb-9 text-xs text-neutral-600">
    {#if displayedPrice}
      Latest observation · {new Date(displayedPrice.observedAt * 1000).toLocaleTimeString()}{displayedPrice.stale || unavailable
        ? ' · Last available price'
        : ''}
    {:else}
      Loading the latest price…
    {/if}
  </p>
</section>
