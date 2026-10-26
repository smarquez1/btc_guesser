<script lang="ts">
  import type { Player } from '../lib/api';

  let { player }: { player: Player | null } = $props();
</script>

<header class="flex items-center justify-between">
  <a class="text-xl font-semibold" href="/">btc guess</a>
  <div class="flex items-center gap-3 text-sm">
    <span>{player?.name ?? 'Connecting…'}</span>
    <span class="text-neutral-600">Your score</span>
    <strong class="text-2xl">{player?.score ?? '—'}</strong>
  </div>
</header>
