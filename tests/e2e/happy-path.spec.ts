import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
  directionButton, expect, expectPending, expectResult, readProfile, submitGuess, test,
} from './fixtures.ts';

test('a correct higher guess earns one persisted point', async ({ page, game }) => {
  await game.open(page);
  const player = await readProfile(page);
  await expect(page.getByText(player.name, { exact: true })).toBeVisible();
  const guess = await submitGuess(page, 'up');
  expect(guess.deadline - guess.startedAt).toBe(60);

  await game.advance([page], guess.deadline - 1, 60_100);
  const pending = await page.request.get(`/api/guesses/${guess.id}`);
  expect((await pending.json()).status).toBe('pending');
  await expect(page.getByRole('status')).toContainText('Checking begins in 1s.');
  await expect(page.locator('header strong')).toHaveText('0');

  await game.advance([page], guess.deadline + 5);
  await expectResult(page, true, 1);
  const result = await (await page.request.get(`/api/guesses/${guess.id}`)).json();
  expect(result.finalPrice).toBeGreaterThan(result.startingPrice);
  expect(result.finalObservedAt).toBeGreaterThanOrEqual(guess.deadline);

  await page.reload();
  await expect(page.getByText(player.name, { exact: true })).toBeVisible();
  await expect(page.locator('header strong')).toHaveText('1');
  expect((await readProfile(page)).pendingGuessId).toBeUndefined();
});

test('a lower guess survives reopening, waits for a change, and loses one point', async ({ game }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'btc-guesser-browser-'));
  const browserOptions = { baseURL: game.origin, viewport: { width: 1440, height: 900 } };
  let context = await chromium.launchPersistentContext(directory, browserOptions);

  try {
    let page = await context.newPage();
    await game.open(page);
    const player = await readProfile(page);
    const guess = await submitGuess(page, 'down');
    const duplicate = await page.request.post('/api/guesses', {
      data: { direction: 'up' }, headers: { origin: game.origin },
    });
    expect(duplicate.status()).toBe(409);

    await context.close();
    context = await chromium.launchPersistentContext(directory, browserOptions);
    page = await context.newPage();
    await game.open(page, { pending: true });
    await expect(page.getByText(player.name, { exact: true })).toBeVisible();
    await expectPending(page, 'down');

    await game.advance([page], guess.deadline + 5);
    const equal = await page.request.get(`/api/guesses/${guess.id}`);
    expect((await equal.json()).status).toBe('pending');
    await expect(page.getByRole('status')).toContainText('Waiting for an eligible price change');
    await expect(page.locator('header strong')).toHaveText('0');
    await page.screenshot({ path: testInfo.outputPath('desktop-pending.png') });

    await game.advance([page], guess.deadline + 11, 60_100);
    await expectResult(page, false, -1);
    await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible();
    await directionButton(page, 'up').focus();
    await page.keyboard.press('Tab');
    await expect(directionButton(page, 'down')).toBeFocused();
    expect(await directionButton(page, 'down').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('desktop-incorrect.png') });

    await page.reload();
    await expect(page.locator('header strong')).toHaveText('-1');
    expect((await readProfile(page)).pendingGuessId).toBeUndefined();
    await page.route('**/api/guesses', route => route.fulfill({
      status: 503, json: { error: 'BTC price unavailable' },
    }));
    await directionButton(page, 'up').click();
    await expect(page.getByRole('alert')).toContainText('BTC price unavailable');
    await expect(page.locator('header strong')).toHaveText('-1');
    await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible();
    await expect(directionButton(page, 'up')).toBeEnabled();
    await expect(directionButton(page, 'down')).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('desktop-error.png') });
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a correct down guess and an incorrect up guess accumulate across rounds', async ({ page, game }) => {
  await game.open(page);
  const first = await submitGuess(page, 'down');
  await game.advance([page], first.deadline + 5, 59_900);
  await expectResult(page, true, 1);

  const second = await submitGuess(page, 'up');
  expect(second.id).not.toBe(first.id);
  expect(second.startingPrice).toBe(59_900);
  await expect(page.locator('header strong')).toHaveText('1');
  await expect(page.getByText('$59,900.00', { exact: true })).toBeVisible();
  await game.advance([page], second.deadline + 5, 59_800);
  await expectResult(page, false, 0);

  await page.reload();
  await expect(page.locator('header strong')).toHaveText('0');
  expect((await readProfile(page)).pendingGuessId).toBeUndefined();
});

test('a changed price observed before the deadline cannot resolve a guess', async ({ page, game }) => {
  await game.open(page);
  const guess = await submitGuess(page, 'up');
  await game.advance([page], guess.deadline - 1);
  await game.cacheObservation(guess.deadline - 1, 60_100);
  await game.advance([page], guess.deadline);

  const response = await page.request.get(`/api/guesses/${guess.id}`);
  expect((await response.json()).status).toBe('pending');
  await expect(page.getByRole('status')).toContainText('Waiting for an eligible price change');
  await expectPending(page, 'up');
  await expect(page.locator('header strong')).toHaveText('0');
  await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible({ timeout: 10_000 });

  await game.advance([page], guess.deadline + 5, 60_100);
  await expectResult(page, true, 1);
  const result = await (await page.request.get(`/api/guesses/${guess.id}`)).json();
  expect(result.finalObservedAt).toBeGreaterThanOrEqual(guess.deadline);
});
