<script lang="ts">
  import type { Guess } from '../lib/api';
  import { dollars } from '../lib/currency';
  import DirectionButton from './DirectionButton.svelte';

  interface Props {
    guess: Guess | null;
    pending: boolean;
    disabled: boolean;
    submitting: boolean;
    syncing: boolean;
    error: string;
    onGuess: (direction: Guess['direction']) => void;
  }

  let {
    guess,
    pending,
    disabled,
    submitting,
    syncing,
    error,
    onGuess,
  }: Props = $props();

  let now = $state(Date.now());
  const deadline = $derived(pending ? guess?.deadline : undefined);
  const remaining = $derived(
    deadline === undefined
      ? 0
      : Math.max(0, Math.ceil((deadline * 1000 - now) / 1000)),
  );
  const resolved = $derived(guess?.status === 'resolved' && !pending);

  $effect(() => {
    if (deadline === undefined) {
      return;
    }

    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);

    return () => clearInterval(timer);
  });

  const feedback = $derived.by(() => {
    if (submitting) {
      return 'Submitting your guess…';
    }

    if (pending && guess) {
      return '';
    }

    if (pending) {
      return 'Waiting for an eligible price change…';
    }

    if (resolved && guess) {
      return `${guess.correct ? 'Correct! +1 point.' : 'Incorrect. −1 point.'} Choose higher or lower to play again.`;
    }

    if (syncing) {
      return 'Connecting to your player…';
    }

    return 'Pick a direction. We’ll check the price after 60 seconds.';
  });

  const detail = $derived(
    pending && guess
      ? `Starting price ${dollars.format(guess.startingPrice)}`
      : resolved && guess?.finalPrice
        ? `Resolved at ${dollars.format(guess.finalPrice)}`
        : 'Live BTC / USD pricing · Powered by Coinbase',
  );
</script>

<section aria-labelledby="question">
  <h2 id="question" class="mb-3 text-2xl">Where will Bitcoin go next?</h2>
  <p class="mb-6 text-sm text-neutral-600" role="status">
    {#if pending && guess}
      Your guess:
      <span class={guess.direction === 'up' ? 'text-green-700' : 'text-red-700'}>
        {guess.direction.toUpperCase()}
      </span>.
      {remaining > 0
        ? `Checking begins in ${remaining}s.`
        : 'Waiting for an eligible price change…'}
    {:else}
      {feedback}
    {/if}
  </p>
  <div class="flex justify-center gap-3">
    <DirectionButton
      direction="up"
      {disabled}
      selected={pending && guess?.direction === 'up'}
      {onGuess}
    />
    <DirectionButton
      direction="down"
      {disabled}
      selected={pending && guess?.direction === 'down'}
      {onGuess}
    />
  </div>
  <p class="mt-5 text-xs text-neutral-600">{detail}</p>
  <p class="mx-auto mt-4 min-h-5 max-w-xl text-sm text-neutral-700" role="alert">
    {error}
  </p>
</section>
