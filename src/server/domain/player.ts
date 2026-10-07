import type { RateLimitPolicy } from "../observability/throttle.js";
import type { DisplayPricing, PriceObservation } from "../pricing/policy.js";

export interface PendingGuess {
  id: string;
  direction: "up" | "down";
  startingPrice: string;
  acceptedAt: number;
  eligibleAt: number;
}
export interface GuessResolution {
  result: "correct" | "incorrect";
  scoreDelta: 1 | -1;
  resolvedAt: number;
  observedPrice: string;
  observedAt: number;
}
export interface ResolvedGuess extends PendingGuess, GuessResolution {}
export interface DueGuess {
  playerId: string;
  guess: PendingGuess;
}
export interface PlayerRecord {
  playerId: string;
  displayName: string;
  sessionDigest: string;
  score: number;
  activeGuess?: PendingGuess;
  latestGuess?: ResolvedGuess;
}
export interface PlayerStore {
  create(player: PlayerRecord): Promise<void>;
  get(playerId: string): Promise<PlayerRecord | undefined>;
  accept(playerId: string, guess: PendingGuess): Promise<PlayerRecord>;
  due(now: number, limit: number): Promise<DueGuess[]>;
  resolve(playerId: string, guess: ResolvedGuess): Promise<PlayerRecord>;
}
export class ActiveGuessConflict extends Error {}
export class ObsoleteGuessConflict extends Error {}
export interface PlayerOptions {
  store?: PlayerStore;
  production?: boolean;
  now?: () => number;
  id?: () => string;
  token?: () => string;
  // T003 owns freshness/validation; null means no fresh trusted observation.
  price?: () => Promise<PriceObservation | null>;
  displayPricing?: () => DisplayPricing;
  // Bounds unauthenticated player creation; overridable for tests.
  creationLimit?: RateLimitPolicy;
  // Enables the creation limiter. Defaults to `production`: development traffic
  // all arrives from one loopback address, so a per-address limit there would be
  // effectively global and block normal play (including private windows).
  rateLimit?: boolean;
}
