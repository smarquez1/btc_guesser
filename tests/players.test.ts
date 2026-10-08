import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerService } from '../server/services/players.ts';
import type { Player } from '../server/types/player.ts';

const id = '6e6680df-e78f-4c44-b1d4-45d27218b82d';

function repository() {
  return {
    get: async (_id: string): Promise<Player | undefined> => undefined,
    create: async (_player: Player) => {},
  };
}

test('invalid identity formats never reach storage', async () => {
  const store = repository();
  store.get = async () => { throw new Error('unexpected lookup'); };
  const service = playerService(store);

  for (const identity of [undefined, '', 'garbage', `${id}extra`, id.replace('-4c44-', '-1c44-')]) {
    assert.equal(await service.find(identity), undefined);
  }
});

test('valid identities return authoritative stored state, including negative scores', async () => {
  const store = repository();
  const player = { id, name: 'Player', score: -3, createdAt: 1800000000 };
  store.get = async (identity) => {
    assert.equal(identity, id);

    return player;
  };

  assert.deepEqual(await playerService(store).find(id), player);
  store.get = async () => undefined;
  assert.equal(await playerService(store).find(id), undefined);
});

test('creation persists zero score with server time', async (t) => {
  t.mock.method(Date, 'now', () => 1800000000999);
  const store = repository();
  let persisted: Player | undefined;
  store.create = async (player) => { persisted = player; };

  const player = await playerService(store).create();

  assert.deepEqual(player, persisted);
  assert.equal(player?.score, 0);
  assert.equal(player?.createdAt, 1800000000);
  assert.match(player?.id ?? '', /^[a-f0-9-]{36}$/);
  assert.ok(player?.name);
});

test('database failures propagate instead of becoming invalid identities', async () => {
  const store = repository();
  const failure = new Error('storage unavailable');
  store.get = async () => { throw failure; };
  store.create = async () => { throw failure; };
  const service = playerService(store);

  await assert.rejects(service.find(id), failure);
  await assert.rejects(service.create(), failure);
});
