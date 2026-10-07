import type { Player } from '../lib/api';

export function GameHeader({ player }: { player: Player | null }) {
  return (
    <header className="flex items-center justify-between">
      <a className="text-xl font-semibold" href="/">btc guess</a>
      <div className="flex items-center gap-3 text-sm">
        <span>{player?.name ?? 'Connecting…'}</span>
        <span className="text-neutral-600">Your score</span>
        <strong className="text-2xl">{player?.score ?? '—'}</strong>
      </div>
    </header>
  );
}
