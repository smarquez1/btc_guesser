import { GameHeader } from './components/GameHeader';
import { GameHelp } from './components/GameHelp';
import { GuessControls } from './components/GuessControls';
import { PriceDisplay } from './components/PriceDisplay';
import { useGame } from './hooks/useGame';
import { usePrice } from './hooks/usePrice';

export function App() {
  const game = useGame();
  const { price, error: priceError } = usePrice();
  const resolved = game.guess?.status === 'resolved' && !game.pending;
  const priceUnavailable = !price || price.stale || Boolean(priceError);
  const error = game.error || priceError || (price?.stale ? 'Price is stale. Waiting for live pricing…' : '');

  return (
    <div className="flex min-h-screen flex-col px-16 py-10">
      <GameHeader player={game.player} />
      <main className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <PriceDisplay price={price} result={resolved ? game.guess : null} unavailable={Boolean(priceError)} />
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
  );
}
