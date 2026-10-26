import type { guessService } from '../services/guesses.ts';
import type { playerService } from '../services/players.ts';
import type { priceService } from '../services/prices.ts';
import type { Guess } from '../types/guess.ts';
import type { Player } from '../types/player.ts';
import type { PriceState } from '../types/price.ts';

export interface GameView {
  player: Pick<Player, 'name' | 'score'>;
  guess: Guess | null;
  lookupGuessId?: string;
  pending: boolean;
  countdownSeconds: number;
  latestPrice: PriceState | null;
  displayedPrice: PriceState | null;
  priceUnavailable: boolean;
  resultPrice: boolean;
  notice?: string;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(price: number) {
  return usd.format(price);
}

function resultPrice(guess: Guess | null, displayed: PriceState | null) {
  return guess?.status === 'resolved' &&
    guess.finalObservedAt !== undefined &&
    guess.finalPrice !== undefined &&
    displayed !== null &&
    displayed.observedAt <= guess.finalObservedAt &&
    displayed.price === guess.finalPrice;
}

export function gameViewService(
  players: ReturnType<typeof playerService>,
  prices: ReturnType<typeof priceService>,
  guesses: ReturnType<typeof guessService>,
) {
  return {
    async load(initialPlayer: Player, rememberedGuessId?: string): Promise<GameView> {
      let player = initialPlayer;
      const guessId = player.pendingGuessId ?? rememberedGuessId;
      let guess: Guess | null = null;

      if (guessId) {
        guess = await guesses.get(player.id, guessId) ?? null;

        if (!guess && player.pendingGuessId) {
          throw new Error('The player points at a missing pending guess');
        }

        if (guess?.status === 'resolved') {
          const latestPlayer = await players.find(player.id);

          if (!latestPlayer) {
            throw new Error('The player disappeared while refreshing game state');
          }

          player = latestPlayer;
        }
      }

      const latestPrice = await prices.get() ?? null;
      let displayedPrice = latestPrice;

      if (guess?.status === 'resolved' && guess.finalPrice !== undefined &&
        guess.finalObservedAt !== undefined &&
        (!latestPrice || latestPrice.observedAt < guess.finalObservedAt)) {
        displayedPrice = {
          symbol: 'BTC-USD',
          price: guess.finalPrice,
          observedAt: guess.finalObservedAt,
          stale: latestPrice?.stale ?? false,
        };
      }

      const pending = Boolean(player.pendingGuessId) || guess?.status === 'pending';
      const countdownSeconds = pending && guess
        ? Math.max(0, guess.deadline - Math.floor(Date.now() / 1000))
        : 0;

      return {
        player: { name: player.name, score: player.score },
        guess,
        lookupGuessId: guess?.id,
        pending,
        countdownSeconds,
        latestPrice,
        displayedPrice,
        priceUnavailable: !latestPrice || latestPrice.stale,
        resultPrice: resultPrice(guess, displayedPrice),
      };
    },
  };
}
