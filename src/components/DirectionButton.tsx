import type { Guess } from '../lib/api';

interface DirectionButtonProps {
  direction: Guess['direction'];
  disabled: boolean;
  selected: boolean;
  onGuess: (direction: Guess['direction']) => void;
}

export function DirectionButton({ direction, disabled, selected, onGuess }: DirectionButtonProps) {
  const higher = direction === 'up';

  return (
    <button
      type="button"
      className="direction-button"
      data-direction={direction}
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => onGuess(direction)}
    >
      <span aria-hidden="true">{higher ? '↑' : '↓'}</span> {higher ? 'GUESS HIGHER' : 'GUESS LOWER'}
    </button>
  );
}
