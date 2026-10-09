import { randomUUID } from 'node:crypto';
import {
  directionButton, expect, expectPending, expectResult, readProfile, submitGuess, test,
  type PublicGuess,
} from './fixtures.ts';

test('a lost submission response recovers the committed guess and scores once', async ({ page, game }) => {
  await game.open(page);
  let committed: PublicGuess | undefined;
  let submissions = 0;
  await page.route('**/api/guesses', async route => {
    submissions += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = await response.json();
    await route.abort('connectionreset');
  });

  await directionButton(page, 'up').click();
  await expect(page.getByRole('alert')).toContainText('Submission could not be confirmed');
  await expectPending(page, 'up');
  expect(committed).toBeDefined();
  const guess = committed as PublicGuess;
  expect((await readProfile(page)).pendingGuessId).toBe(guess.id);
  expect(submissions).toBe(1);

  await game.advance([page], guess.deadline + 5, 60_100);
  await expectResult(page, true, 1);
  await page.request.get(`/api/guesses/${guess.id}`);
  expect((await readProfile(page)).score).toBe(1);
  expect(submissions).toBe(1);
});

test('competing tabs converge on one guess and the same persisted score', async ({ page, context, game }) => {
  await game.open(page);
  const other = await context.newPage();
  await game.open(other);
  expect(await readProfile(other)).toEqual(await readProfile(page));

  // Hold both submissions until both tabs have sent their request.
  let release: () => void = () => {};
  const bothArrived = new Promise<void>(resolve => { release = resolve; });
  let arrivals = 0;
  await context.route('**/api/guesses', async route => {
    arrivals += 1;

    if (arrivals === 2) {
      release();
    }

    await bothArrived;
    await route.continue();
  });
  const responses = [page, other].map(tab => tab.waitForResponse(response =>
    response.url().endsWith('/api/guesses') && response.request().method() === 'POST',
  ));
  await Promise.all([directionButton(page, 'up').click(), directionButton(other, 'down').click()]);
  const submissions = await Promise.all(responses);
  expect(submissions.map(response => response.status()).sort()).toEqual([201, 409]);
  const winner = submissions[0].status() === 201 ? submissions[0] : submissions[1];
  const guess: PublicGuess = await winner.json();

  for (const tab of [page, other]) {
    await expectPending(tab, guess.direction);
    expect((await readProfile(tab)).pendingGuessId).toBe(guess.id);
  }

  const finalPrice = guess.direction === 'up' ? 60_100 : 59_900;
  await game.advance([page, other], guess.deadline + 5, finalPrice);
  await Promise.all([expectResult(page, true, 1), expectResult(other, true, 1)]);
  expect((await readProfile(page)).pendingGuessId).toBeUndefined();
  expect((await readProfile(other)).score).toBe(1);
});

test('pending polling recovers after a connection interruption across the deadline', async ({ page, game }) => {
  await game.open(page);
  const guess = await submitGuess(page, 'up');
  let disconnected = true;
  await page.route('**/api/**', route => disconnected
    ? route.abort('connectionreset') : route.continue());
  await game.advance([page], guess.deadline + 5, 60_100);

  await expect(page.getByRole('alert')).toContainText('Could not connect');
  await expect(page.getByText(/Latest observation .*Last available price/)).toBeVisible({ timeout: 10_000 });
  await expectPending(page, 'up');
  await expect(page.locator('header strong')).toHaveText('0');
  await expect(page.getByText('$60,000.00', { exact: true })).toBeVisible();

  disconnected = false;
  await expectResult(page, true, 1);
  await expect(page.getByRole('alert')).toBeEmpty();
  await expect(page.getByText('$60,100.00', { exact: true })).toBeVisible();
  expect((await readProfile(page)).pendingGuessId).toBeUndefined();
});

test('an unknown identity cookie is replaced once and remains playable', async ({ page, context, game }) => {
  const invalidIdentity = randomUUID();
  await context.addCookies([{
    name: 'btc_player', value: invalidIdentity, domain: '127.0.0.1', path: '/api',
    httpOnly: true, sameSite: 'Strict',
  }]);
  const creationStatuses: number[] = [];
  const profileStatuses: number[] = [];
  page.on('response', response => {
    if (response.url().endsWith('/api/players') && response.request().method() === 'POST') {
      creationStatuses.push(response.status());
    }

    if (response.url().endsWith('/api/players/me')) {
      profileStatuses.push(response.status());
    }
  });
  await game.open(page);
  expect(profileStatuses).toContain(401);
  expect(creationStatuses).toEqual([201]);
  const identity = (await context.cookies()).find(cookie => cookie.name === 'btc_player');
  expect(identity?.value).not.toBe(invalidIdentity);
  expect(identity?.httpOnly).toBe(true);
  const profile = await readProfile(page);

  await page.reload();
  await expect(directionButton(page, 'up')).toBeEnabled();
  expect(await readProfile(page)).toEqual(profile);
  expect(creationStatuses).toEqual([201]);
  await submitGuess(page, 'down');
});
