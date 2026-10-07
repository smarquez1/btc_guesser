import type { ReactNode } from 'react';
import type { Guess } from '../lib/api';
import { dollars } from '../lib/currency';
import { DirectionButton } from './DirectionButton';
import { useCountdown } from '../hooks/useCountdown';

interface GuessControlsProps {
  guess: Guess | null;
  pending: boolean;
  disabled: boolean;
  submitting: boolean;
  syncing: boolean;
  error: string;
  onGuess: (direction: Guess['direction']) => void;
}

export function GuessControls({
  guess, pending, disabled, submitting, syncing, error, onGuess,
}: GuessControlsProps) {
  const remaining = useCountdown(pending ? guess?.deadline : undefined);
  const resolved = guess?.status === 'resolved' && !pending;
  let feedback: ReactNode = 'Pick a direction. We’ll check the price after 60 seconds.';

  if (submitting) {
    feedback = 'Submitting your guess…';
  } else if (pending && guess) {
    feedback = (
      <>
        Your guess: <span className={guess.direction === 'up' ? 'text-green-700' : 'text-red-700'}>{guess.direction.toUpperCase()}</span>.{' '}
        {remaining > 0 ? `Result in ${remaining}s.` : 'Waiting for an eligible price change…'}
      </>
    );
  } else if (pending) {
    feedback = 'Waiting for an eligible price change…';
  } else if (resolved) {
    feedback = `${guess.correct ? 'Correct! +1 point.' : 'Incorrect. −1 point.'} Choose higher or lower to play again.`;
  } else if (syncing) {
    feedback = 'Connecting to your player…';
  }

  let detail = 'Live BTC / USD pricing · Powered by Coinbase';

  if (pending && guess) {
    detail = `Starting price ${dollars.format(guess.startingPrice)}`;
  } else if (resolved && guess.finalPrice) {
    detail = `Resolved at ${dollars.format(guess.finalPrice)}`;
  }

  return (
    <section aria-labelledby="question">
      <h2 id="question" className="mb-3 text-2xl">Where will Bitcoin go next?</h2>
      <p className="mb-6 text-sm text-neutral-600" role="status">{feedback}</p>
      <div className="flex justify-center gap-3">
        <DirectionButton direction="up" disabled={disabled} selected={pending && guess?.direction === 'up'} onGuess={onGuess} />
        <DirectionButton direction="down" disabled={disabled} selected={pending && guess?.direction === 'down'} onGuess={onGuess} />
      </div>
      <p className="mt-5 text-xs text-neutral-600">{detail}</p>
      <p className="mx-auto mt-4 min-h-5 max-w-xl text-sm text-neutral-700" role="alert">{error}</p>
    </section>
  );
}
