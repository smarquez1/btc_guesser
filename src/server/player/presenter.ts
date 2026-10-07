import type {
  PendingGuess,
  PlayerRecord,
  ResolvedGuess,
} from "../domain/player.js";

export function publicPlayer(player: PlayerRecord) {
  const guess = (value: PendingGuess | ResolvedGuess | undefined) => {
    if (!value) return null;
    const pending = {
      id: value.id,
      direction: value.direction,
      startingPrice: value.startingPrice,
      acceptedAt: value.acceptedAt,
      eligibleAt: value.eligibleAt,
    };
    if (!("result" in value)) return pending;
    return {
      ...pending,
      result: value.result,
      scoreDelta: value.scoreDelta,
      resolvedAt: value.resolvedAt,
      observedPrice: value.observedPrice,
      observedAt: value.observedAt,
    };
  };
  return {
    id: player.playerId,
    displayName: player.displayName,
    score: player.score,
    activeGuess: guess(player.activeGuess),
    latestGuess: guess(player.latestGuess),
  };
}
