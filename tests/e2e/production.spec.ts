import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { priceRepository } from '../../server/repositories/prices.ts';
import { createLocalDatabase } from '../helpers/localDatabase.ts';
import { launchProductionServer, startProductionServer } from '../helpers/productionServer.ts';

test('the production entrypoint serves built assets and preserves the player on reload', async ({ page, context }) => {
  const database = await createLocalDatabase();
  let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;

  try {
    const now = Math.floor(Date.now() / 1000);
    await priceRepository(database.documentClient, database.config.tableName).save({
      symbol: 'BTC-USD', tradeId: 1, price: 60_000, observedAt: now,
      freshUntil: now + 3600, expiresAt: now + 3600,
    });
    server = await startProductionServer(database.environment);
    const { origin } = server;
    const htmlResponse = await page.goto(origin);
    expect(htmlResponse?.status()).toBe(200);
    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeEnabled();
    await expect(page.getByText('$60,000.00', { exact: true })).toBeVisible();
    await expect(page.locator('header strong')).toHaveText('0');

    const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('src') ?? element.getAttribute('href')),
    );
    expect(assets.some(asset => asset?.endsWith('.js'))).toBe(true);
    expect(assets.some(asset => asset?.endsWith('.css'))).toBe(true);

    for (const asset of assets) {
      expect(asset).toMatch(/^\/assets\//);
      const response = await page.request.get(`${origin}${asset}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(asset?.endsWith('.js') ? /javascript/ : /css/);
    }

    const profile = await (await page.request.get(`${origin}/api/players/me`)).json();
    const cookie = (await context.cookies()).find(value => value.name === 'btc_player');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe('/api');
    await page.getByRole('button', { name: 'GUESS HIGHER' }).click();
    await expect(page.getByRole('status')).toContainText('Your guess: UP.');
    const pendingProfile = await (await page.request.get(`${origin}/api/players/me`)).json();
    expect(pendingProfile.pendingGuessId).toBeTruthy();

    await page.reload();
    await expect(page.getByText(profile.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Your guess: UP.');
    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeDisabled();
    expect(await (await page.request.get(`${origin}/api/players/me`)).json()).toEqual(pendingProfile);
    const unknown = await page.request.get(`${origin}/api/unknown`);
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()['content-type']).toContain('application/json');
  } finally {
    try {
      await server?.close();
    } finally {
      await database.close();
    }
  }
});

test('production startup fails when the frontend build is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btc-guesser-missing-build-'));
  const database = await createLocalDatabase();

  try {
    // Copy the real entrypoint and dependencies without moving the workspace build.
    await cp('server', join(directory, 'server'), { recursive: true });
    await cp('package.json', join(directory, 'package.json'));
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    const server = launchProductionServer(database.environment, join(directory, 'server/index.ts'));

    try {
      const [code] = await server.exited;
      expect(code).toBe(1);
      expect(server.output()).toContain('ENOENT');
      expect(server.output()).toContain('dist/index.html');
    } finally {
      await server.close();
    }
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
