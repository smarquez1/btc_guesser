<script lang="ts">
  import type { Guess } from '../lib/api';

  interface Props {
    direction: Guess['direction'];
    disabled: boolean;
    selected: boolean;
    onGuess: (direction: Guess['direction']) => void;
  }

  let { direction, disabled, selected, onGuess }: Props = $props();
  const higher = $derived(direction === 'up');
</script>

<button
  type="button"
  class="direction-button"
  data-direction={direction}
  {disabled}
  aria-pressed={selected}
  onclick={() => onGuess(direction)}
>
  <span aria-hidden="true">{higher ? '↑' : '↓'}</span>
  {higher ? 'GUESS HIGHER' : 'GUESS LOWER'}
</button>
