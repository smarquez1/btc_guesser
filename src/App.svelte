<script lang="ts">
  import GameHeader from './components/GameHeader.svelte';
  import GameHelp from './components/GameHelp.svelte';
  import GuessControls from './components/GuessControls.svelte';
  import PriceDisplay from './components/PriceDisplay.svelte';
  import { createGame } from './lib/game.svelte';
  import { createPrice } from './lib/price.svelte';

  const game = createGame();
  const priceState = createPrice();

  const resolved = $derived(
    game.guess?.status === 'resolved' && !game.pending ? game.guess : null,
  );
  const priceUnavailable = $derived(
    !priceState.price || priceState.price.stale || Boolean(priceState.error),
  );
  const error = $derived(
    game.error ||
      priceState.error ||
      (priceState.price?.stale
        ? 'Price is stale. Waiting for live pricing…'
        : ''),
  );
</script>

<div class="flex min-h-screen flex-col px-16 py-10">
  <GameHeader player={game.player} />
  <main class="flex flex-1 flex-col items-center justify-center py-16 text-center">
    <PriceDisplay
      price={priceState.price}
      result={resolved}
      unavailable={Boolean(priceState.error)}
    />
    <GuessControls
      guess={game.guess}
      pending={game.pending}
      disabled={game.disabled || priceUnavailable}
      submitting={game.submitting}
      syncing={game.syncing}
      error={error}
      onGuess={(direction) => void game.submit(direction)}
    />
  </main>
  <GameHelp />
</div>
