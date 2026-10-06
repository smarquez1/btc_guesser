import { expect, test } from "@playwright/test";

const CONTROL_BASE = "http://127.0.0.1:3301";
const SEEDED_DISPLAY_NAME = "E2E Ada Lovelace";

/**
 * One focused real-browser journey against the real Fastify app and DynamoDB
 * Local, with an injected ticker and a loopback-only control channel. No live
 * Coinbase call and no real-minute wait: the fixture shortens the acceptance
 * window and the server resolves on a short poll.
 */
test("core journey: onboard, guess, resolve, score, and persist", async ({
  page,
  context,
  request,
}) => {
  // Capture browser output before any navigation so nothing is missed.
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    const location = message.location();
    consoleMessages.push(
      `${message.type()}: ${message.text()}${location.url ? ` @ ${location.url}` : ""}`,
    );
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  // Control browser timers so the client's poll fires on demand. The clock is
  // context-scoped, so it also survives the final reload. Install before goto.
  await context.clock.install();

  // Clean isolated state for a repeatable run (the unique table may be reused).
  const reset = await request.post(`${CONTROL_BASE}/reset`);
  expect(reset.ok()).toBe(true);

  await page.goto("/");

  // Onboarding with a recognizable, seeded display name.
  await page
    .getByRole("textbox", { name: "Display name" })
    .fill(SEEDED_DISPLAY_NAME);
  await page.getByRole("button", { name: "Start playing" }).click();

  // Play view: score 0 and the injected price are visible.
  await expect(page.getByText("· Score: 0")).toBeVisible();
  await expect(page.getByText("$100.00")).toBeVisible();

  // Move the price through the test-only control channel, then guess up.
  const moved = await request.post(`${CONTROL_BASE}/price`, {
    data: { price: "101.00" },
  });
  expect(moved.ok()).toBe(true);

  const upButton = page.getByRole("button", { name: "Up", exact: true });
  const downButton = page.getByRole("button", { name: "Down", exact: true });
  await upButton.click();

  // Pending: the accepted guess blocks both controls until it resolves.
  await expect(upButton).toBeDisabled();
  await expect(downButton).toBeDisabled();
  await expect(page.getByText(/You guessed up from/)).toBeVisible();

  // Change the price again only after acceptance, so the first fresh
  // post-deadline observation is guaranteed to differ from the starting price.
  const resolved = await request.post(`${CONTROL_BASE}/price`, {
    data: { price: "200.00" },
  });
  expect(resolved.ok()).toBe(true);

  // The installed clock does not accelerate the real server, so first wait for
  // the backend to resolve the guess (network is unaffected by the clock).
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () =>
            (await (await fetch("/api/player")).json()).activeGuess === null,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Then fire the client's poll timer and wait for the authoritative response
  // it triggers. `runFor` does not await the fetch, so arm the waiter first.
  const resultCard = page.getByRole("status").filter({ hasText: "Score +1" });
  await expect(async () => {
    const polled = page.waitForResponse(
      (response) =>
        response.url().includes("/api/player") &&
        response.request().method() === "GET",
      { timeout: 3_000 },
    );
    await page.clock.runFor(5_000);
    await polled;
    await expect(resultCard).toContainText("Correct", { timeout: 500 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("· Score: 1")).toBeVisible();

  // Reload: score and latest result persist, and no guess stays active.
  await page.reload();
  await expect(page.getByText("· Score: 1")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Score +1" }),
  ).toContainText("Correct");
  await expect(
    page.getByRole("button", { name: "Up", exact: true }),
  ).toBeEnabled();

  // The session credential is HttpOnly and invisible to page scripts.
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === "btc_player",
  );
  expect(cookie?.httpOnly).toBe(true);
  const documentCookie = await page.evaluate(() => document.cookie);
  expect(documentCookie).not.toContain("btc_player");

  // No uncaught errors. Warnings/info (Vite HMR, React DevTools) are expected,
  // so only console errors are checked; the one legitimate console error is the
  // initial unauthenticated GET /api/player (401) that drives onboarding. Every
  // other console error is a failure. Redaction still scans every message.
  expect(pageErrors).toEqual([]);
  const consoleErrors = consoleMessages.filter((message) =>
    message.startsWith("error:"),
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !(message.includes("401") && message.includes("/api/player")),
  );
  expect(unexpectedConsoleErrors).toEqual([]);

  const credentialToken = cookie?.value.split(".")[1] ?? "";
  for (const message of consoleMessages) {
    expect(message).not.toContain(SEEDED_DISPLAY_NAME);
    expect(message).not.toContain("btc_player");
    if (credentialToken) {
      expect(message).not.toContain(credentialToken);
    }
  }
});
