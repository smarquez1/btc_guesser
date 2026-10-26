import { resolve } from 'node:path';
import { mock } from 'node:test';
import fastifyStatic from '@fastify/static';
import { expect, test as base, type Page } from '@playwright/test';
import { buildApp } from '../../server/app.ts';
import { guessRepository } from '../../server/repositories/guesses.ts';
import { playerRepository } from '../../server/repositories/players.ts';
import { priceRepository } from '../../server/repositories/prices.ts';
import type { Guess } from '../../server/types/guess.ts';
import type { Player } from '../../server/types/player.ts';
import { createLocalDatabase } from '../helpers/localDatabase.ts';

export type PublicGuess = Omit<Guess, 'playerId' | 'expiresAt'>;
export type PublicPlayer = Pick<Player, 'name' | 'score' | 'pendingGuessId'>;

async function createGame() {
  const database = await createLocalDatabase();
  database.config.viteDevServerOrigin = undefined;
  let price = 60_000;
  let tradeId = 0;
  const app = buildApp(database.config, async () => ({
    tradeId: ++tradeId, price, observedAt: Math.floor(Date.now() / 1000),
  }));
  app.register(fastifyStatic, { root: resolve('dist/assets'), prefix: '/assets/' });
  let origin: string;

  async function close() {
    try {
      await app.close();
    } finally {
      mock.timers.reset();
      await database.close();
    }
  }

  try {
    // Control Date alone so socket and polling timers keep running normally.
    mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
    origin = await app.listen({ host: '127.0.0.1', port: 0 });
    // The OS chooses the port; set the allowed origin before browser requests.
    database.config.appOrigin = origin;
  } catch (error) {
    await close();
    throw error;
  }

  async function open(page: Page, options: { pending?: boolean } = {}) {
    await page.clock.setFixedTime(Date.now());
    await page.goto(origin);
    await expect(page.locator('[data-score]')).toHaveText('0');
    await expect(page.getByText('$60,000.00', { exact: true })).toBeVisible();

    if (!options.pending) {
      await expect(directionButton(page, 'up')).toBeEnabled();
    }
  }

  async function advance(pages: Page[], epochSeconds: number, nextPrice = price) {
    price = nextPrice;
    mock.timers.setTime(epochSeconds * 1000);

    for (const page of pages) {
      await page.clock.setFixedTime(epochSeconds * 1000);
    }
  }

  async function cacheObservation(observedAt: number, nextPrice: number) {
    await priceRepository(database.documentClient, database.config.tableName).save({
      symbol: 'BTC-USD', tradeId: ++tradeId, price: nextPrice, observedAt,
      freshUntil: Math.floor(Date.now() / 1000) + 5, expiresAt: observedAt + 3600,
    });
  }

  async function readProfile(page: Page): Promise<PublicPlayer> {
    const cookie = (await page.context().cookies(`${origin}/api/game`))
      .find(candidate => candidate.name === 'btc_player');

    if (!cookie) throw new Error('The browser has no player cookie');

    const stored = await playerRepository(database.documentClient, database.config.tableName).get(cookie.value);

    if (!stored) throw new Error('The player cookie has no stored profile');

    return {
      name: stored.name,
      score: stored.score,
      ...(stored.pendingGuessId ? { pendingGuessId: stored.pendingGuessId } : {}),
    };
  }

  async function readGuess(page: Page, id: string): Promise<PublicGuess> {
    const cookie = (await page.context().cookies(`${origin}/api/game`))
      .find(candidate => candidate.name === 'btc_player');

    if (!cookie) throw new Error('The browser has no player cookie');

    const stored = await guessRepository(database.documentClient, database.config.tableName).get(id);

    if (!stored || stored.playerId !== cookie.value) throw new Error('The guess is not stored for this player');

    const { playerId: _playerId, expiresAt: _expiresAt, ...result } = stored;

    return result;
  }

  async function submit(page: Page, direction: 'up' | 'down'): Promise<PublicGuess> {
    await directionButton(page, direction).click();
    await expectPending(page, direction);
    const profile = await readProfile(page);

    if (!profile.pendingGuessId) throw new Error('The profile has no pending guess after submission');

    return readGuess(page, profile.pendingGuessId);
  }

  return { origin, open, advance, cacheObservation, readProfile, readGuess, submit, close };
}

export const test = base.extend<{ game: Awaited<ReturnType<typeof createGame>> }>({
  baseURL: async ({ game }, use) => {
    await use(game.origin);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture dependencies.
  game: async ({}, use) => {
    const game = await createGame();

    try {
      await use(game);
    } finally {
      await game.close();
    }
  },
});

export { expect };

export function directionButton(page: Page, direction: 'up' | 'down') {
  return page.getByRole('button', { name: direction === 'up' ? 'GUESS HIGHER' : 'GUESS LOWER' });
}

export async function submitGuess(
  page: Page,
  direction: 'up' | 'down',
  game: Awaited<ReturnType<typeof createGame>>,
): Promise<PublicGuess> {
  return game.submit(page, direction);
}

export async function expectPending(page: Page, direction: 'up' | 'down') {
  await expect(directionButton(page, 'up')).toBeDisabled();
  await expect(directionButton(page, 'down')).toBeDisabled();
  await expect(directionButton(page, direction)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toContainText(`Your guess: ${direction.toUpperCase()}.`);
}

export async function expectResult(page: Page, correct: boolean, score: number) {
  await expect(page.getByRole('status')).toContainText(
    correct ? 'Correct! +1 point.' : 'Incorrect. −1 point.', { timeout: 10_000 },
  );
  await expect(page.locator('[data-score]')).toHaveText(String(score));
  await expect(directionButton(page, 'up')).toBeEnabled();
  await expect(directionButton(page, 'down')).toBeEnabled();
}
