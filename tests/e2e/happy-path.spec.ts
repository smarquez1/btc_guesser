import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { chromium, expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { buildApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { createDynamoDB } from '../../server/lib/dynamodb.ts';

const endpoint = process.env.DYNAMODB_ENDPOINT;

if (!endpoint || new URL(endpoint).protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)) {
  throw new Error('Set DYNAMODB_ENDPOINT in .env to a local DynamoDB HTTP endpoint');
}

// Use only local credentials and a unique table, never the application table.
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;

const config = loadConfig({
  ...process.env,
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE: `btc-guess-e2e-${randomUUID()}`,
  APP_ORIGIN: 'http://127.0.0.1:5174',
  HOST: '127.0.0.1',
  PORT: '3001',
  COOKIE_SECURE: 'false',
});
const { client } = createDynamoDB(config);
let tradeId = 0;
let controlledPrice: number | undefined;
const app = buildApp(config, async () => {
  tradeId += 1;

  return {
    tradeId,
    price: controlledPrice ?? 60_000 + tradeId,
    observedAt: Math.floor(Date.now() / 1000),
  };
});
let vite: ViteDevServer | undefined;
let tableCreated = false;

test.beforeAll(async () => {
  await client.send(new CreateTableCommand({
    TableName: config.tableName,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
  }));
  tableCreated = true;

  await app.listen({ port: config.port, host: config.host });
  vite = await createServer({
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: { '/api': 'http://127.0.0.1:3001' },
    },
  });
  await vite.listen();
});

test.afterAll(async () => {
  try {
    await vite?.close();
    await app.close();
  } finally {
    try {
      if (tableCreated) {
        await client.send(new DeleteTableCommand({ TableName: config.tableName }));
      }
    } finally {
      client.destroy();
    }
  }
});

test.afterEach(() => {
  mock.timers.reset();
  controlledPrice = undefined;
});

test('a correct higher guess earns one persisted point', async ({ page }) => {
  const startedAt = Date.now();
  // Fastify runs in this worker. Mock only Date so network timers stay real.
  mock.timers.enable({ apis: ['Date'], now: startedAt });
  await page.clock.setFixedTime(startedAt);

  const creationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/players') && response.request().method() === 'POST',
  );
  await page.goto('/');
  const creation = await creationResponse;
  expect(creation.status()).toBe(201);
  const player = await creation.json();
  expect(player.score).toBe(0);

  const higher = page.getByRole('button', { name: 'GUESS HIGHER' });
  const lower = page.getByRole('button', { name: 'GUESS LOWER' });
  const score = page.locator('header strong');
  await expect(page.getByText(player.name, { exact: true })).toBeVisible();
  await expect(score).toHaveText('0');
  await expect(page.getByText(/\$60,\d{3}\.00/, { exact: true })).toBeVisible();
  await expect(higher).toBeEnabled();

  const submissionResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/guesses') && response.request().method() === 'POST',
  );
  await higher.click();
  const submission = await submissionResponse;
  expect(submission.status()).toBe(201);
  const guess = await submission.json();
  expect(guess.deadline - guess.startedAt).toBe(60);
  await expect(higher).toBeDisabled();
  await expect(lower).toBeDisabled();
  await expect(higher).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toContainText('Checking begins in');

  // Keep the actual 60-second rule and stored deadline; advance both clocks.
  const beforeDeadline = (guess.deadline - 1) * 1000;
  mock.timers.setTime(beforeDeadline);
  await page.clock.setFixedTime(beforeDeadline);
  const pendingResponse = await page.request.get(`/api/guesses/${guess.id}`);
  expect(pendingResponse.ok()).toBe(true);
  expect((await pendingResponse.json()).status).toBe('pending');
  await expect(page.getByRole('status')).toContainText('Checking begins in 1s.');
  await expect(score).toHaveText('0');

  // Also expire any five-second cache refreshed just before the deadline.
  const afterDeadline = (guess.deadline + 5) * 1000;
  mock.timers.setTime(afterDeadline);
  await page.clock.setFixedTime(afterDeadline);
  await expect(page.getByRole('status')).toContainText('Correct! +1 point.', { timeout: 10_000 });
  await expect(score).toHaveText('1');
  await expect(higher).toBeEnabled();
  await expect(lower).toBeEnabled();

  const resultResponse = await page.request.get(`/api/guesses/${guess.id}`);
  expect(resultResponse.ok()).toBe(true);
  const result = await resultResponse.json();
  expect(result.status).toBe('resolved');
  expect(result.correct).toBe(true);
  expect(result.scoreDelta).toBe(1);
  expect(result.finalPrice).toBeGreaterThan(result.startingPrice);
  expect(result.finalObservedAt).toBeGreaterThanOrEqual(result.deadline);

  await page.reload();
  await expect(page.getByText(player.name, { exact: true })).toBeVisible();
  await expect(score).toHaveText('1');
  await expect(higher).toBeEnabled();

  const profileResponse = await page.request.get('/api/players/me');
  expect(profileResponse.ok()).toBe(true);
  const profile = await profileResponse.json();
  expect(profile.score).toBe(1);
  expect(profile.pendingGuessId).toBeUndefined();
});

test('a lower guess survives reopening, waits for a change, and loses one point', async () => {
  // Move beyond the prior test's cache and keep prices equal until explicitly changed.
  const startedAt = Date.now() + 300_000;
  mock.timers.enable({ apis: ['Date'], now: startedAt });
  controlledPrice = 60_000;
  const profileDirectory = await mkdtemp(join(tmpdir(), 'btc-guesser-browser-'));
  let context = await chromium.launchPersistentContext(profileDirectory, { viewport: { width: 1440, height: 900 } });

  try {
    let page = await context.newPage();
    await page.clock.setFixedTime(startedAt);
    await page.goto('http://127.0.0.1:5174');
    await expect(page.locator('header strong')).toHaveText('0');
    await expect(page.getByText('$60,000.00', { exact: true })).toBeVisible();
    const name = await page.locator('header').textContent() ?? '';
    const submissionResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/guesses') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'GUESS LOWER' }).click();
    const submission = await submissionResponse;
    expect(submission.status()).toBe(201);
    const guess = await submission.json();
    expect(guess.direction).toBe('down');

    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'GUESS LOWER' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'GUESS LOWER' })).toHaveAttribute('aria-pressed', 'true');
    const duplicate = await page.request.post('/api/guesses', {
      data: { direction: 'up' }, headers: { origin: config.appOrigin },
    });
    expect(duplicate.status()).toBe(409);

    // Close Chromium itself; the same disk profile retains the HTTP-only identity cookie.
    await context.close();
    context = await chromium.launchPersistentContext(profileDirectory, { viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.clock.setFixedTime(startedAt);
    await page.goto('http://127.0.0.1:5174');
    await expect(page.locator('header')).toHaveText(name);
    await expect(page.getByRole('status')).toContainText('Your guess: DOWN.');
    await expect(page.getByRole('button', { name: 'GUESS LOWER' })).toBeDisabled();

    const equalAt = (guess.deadline + 5) * 1000;
    mock.timers.setTime(equalAt);
    await page.clock.setFixedTime(equalAt);
    const equalResponse = await page.request.get(`/api/guesses/${guess.id}`);
    expect(equalResponse.ok()).toBe(true);
    expect((await equalResponse.json()).status).toBe('pending');
    await expect(page.getByRole('status')).toContainText('Waiting for an eligible price change');
    await expect(page.locator('header strong')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeDisabled();
    await expect(page.getByText('$60,000.00', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/desktop-pending.png' });

    controlledPrice = 60_100;
    const changedAt = equalAt + 6_000;
    mock.timers.setTime(changedAt);
    await page.clock.setFixedTime(changedAt);
    await expect(page.getByRole('status')).toContainText('Incorrect. −1 point.', { timeout: 10_000 });
    await expect(page.locator('header strong')).toHaveText('-1');
    await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'GUESS LOWER' })).toBeEnabled();
    await page.getByRole('button', { name: 'GUESS HIGHER' }).focus();
    await page.keyboard.press('Tab');
    const lower = page.getByRole('button', { name: 'GUESS LOWER' });
    await expect(lower).toBeFocused();
    expect(await lower.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: 'test-results/desktop-incorrect.png' });

    const result = await (await page.request.get(`/api/guesses/${guess.id}`)).json();
    expect(result.correct).toBe(false);
    expect(result.scoreDelta).toBe(-1);
    expect(result.finalObservedAt).toBeGreaterThanOrEqual(guess.deadline);
    await page.reload();
    await expect(page.locator('header strong')).toHaveText('-1');
    const profile = await (await page.request.get('/api/players/me')).json();
    expect(profile.score).toBe(-1);
    expect(profile.pendingGuessId).toBeUndefined();

    // A controlled HTTP failure checks inline feedback without creating another guess.
    await page.route('**/api/guesses', route => route.fulfill({
      status: 503, json: { error: 'BTC price unavailable' },
    }));
    await page.getByRole('button', { name: 'GUESS HIGHER' }).click();
    await expect(page.getByRole('alert')).toContainText('BTC price unavailable');
    await expect(page.locator('header strong')).toHaveText('-1');
    await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GUESS HIGHER' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'GUESS LOWER' })).toBeEnabled();
    await page.screenshot({ path: 'test-results/desktop-error.png' });
  } finally {
    await context.close();
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
