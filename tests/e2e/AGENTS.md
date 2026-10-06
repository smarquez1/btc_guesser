# E2E test instructions (`tests/e2e`)

Scope: **one** focused real-browser journey through the core game loop. Do not grow
this into a large E2E suite; keep rule/unit coverage in Vitest and UI coverage in
React Testing Library, and extend the owning layer instead of duplicating cases here.

## Commands

- One-time browser install: `pnpm exec playwright install chromium`
- Run: `pnpm test:e2e` (requires a running loopback DynamoDB Local and `.env`)
- Not part of pre-commit (keep commits fast); CI wiring belongs to T103.

## How it runs

- `tests/e2e/server.ts` is a **test-only launcher**. It builds the real Fastify app
  (`buildApp`) against an isolated DynamoDB Local table `btc-guesser-e2e-<uuid>`,
  injects a fake Coinbase ticker `fetch`, and exposes a loopback-only control
  channel (`POST /price`, `POST /reset`). Nothing here is imported by the deployed
  application.
- Dedicated ports so they never collide with development: backend `3300`, frontend
  `5373`, control `3301`. The dev API on `3000` and Vite on `5173` stay untouched.
- `vite.e2e.config.ts` proxies `/api` to `3300`; `playwright.config.ts` starts both
  web servers and runs one Chromium worker.
- `tests/e2e/global-teardown.ts` removes leftover `btc-guesser-e2e-*` tables only.

## Rules

- Never add test endpoints, switches, or backdoors to the deployed app. Controls
  live only in this fixture and bind to loopback.
- The journey must hit the real backend and real DynamoDB Local; do not substitute
  route mocks for backend evidence.
- No live Coinbase calls and no real-minute waits. Server time is real: shorten the
  acceptance window with `GUESS_MIN_WAIT_MS` (test-only env set by the Playwright
  `webServer`) and the test-only resolver poll interval.
- Control browser timers with Playwright's clock: `await context.clock.install()`
  **before** `page.goto()`, then `page.clock.runFor(ms)` to fire the recursive poll
  timer. `runFor` does not await the fetch it triggers, so arm
  `page.waitForResponse(...)` before advancing. Never use hard `waitForTimeout`
  sleeps.
- Keep artifacts disabled (`trace`/`screenshot`/`video` off): no traces,
  screenshots, or video that could capture a session credential.
- Assertions must include browser-boundary redaction: the seeded display name,
  `btc_player`, and the session token never appear in any console message, and
  there are no unexpected console errors or page errors.
- Only ever create/delete isolated `btc-guesser-e2e-*` tables; never touch
  `btc-guesser-local` or another developer's data.
- Keep specs in `tests/e2e/*.spec.ts` so Vitest discovery (`src/**`) never picks
  them up. Keep new files under Biome coverage and in `tsconfig.e2e.json`.
