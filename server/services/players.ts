import { randomUUID } from 'node:crypto';
import type { playerRepository } from '../repositories/players.ts';
import type { Player } from '../types/player.ts';

export function playerService(repository: ReturnType<typeof playerRepository>) {
  return {
    async find(identity: string | undefined) {
      if (!identity || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity)) {
        return undefined;
      }

      return repository.get(identity);
    },

    async create(): Promise<Player> {
      const now = Math.floor(Date.now() / 1000);
      const id = randomUUID();
      const player = { id, name: `Player ${id.slice(0, 8)}`, score: 0, createdAt: now };
      await repository.create(player);

      return player;
    },
  };
}
