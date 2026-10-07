export interface Guess {
  id: string;
  playerId: string;
  direction: 'up' | 'down';
  status: 'pending' | 'resolved';
  startingPrice: number;
  startingObservedAt: number;
  startedAt: number;
  deadline: number;
  resolvedAt?: number;
  finalPrice?: number;
  finalObservedAt?: number;
  correct?: boolean;
  scoreDelta?: number;
  expiresAt?: number;
}
