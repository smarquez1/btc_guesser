# T006 — Verify the core journey

**Status:** Done — implemented 2026-10-06. Full gate green: `pnpm check`,
`pnpm build`, `pnpm test:integration`, and `pnpm test:e2e`.

**Goal:** Test critical behavior without building a large or redundant E2E suite.

**Dependencies:** [T002 — Player state](T002-player-state.md),
[T003 — Pricing](T003-btc-pricing.md), [T004 — Resolution](T004-game-rules.md),
and [T005 — Interface](T005-game-interface.md).

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md). Use the project testing guidance
where useful, without adding its optional dependencies by default.

## In scope

- Inventory existing tests first. Build a small gap-closing matrix mapping each
  critical behavior to existing/new evidence; extend the owning layer rather than
  duplicating every case in browser tests.

| Layer | Required evidence |
|---|---|
| Vitest rules/pricing | Exact decimal comparison; receipt-time deadline boundaries; pre-deadline move still present afterward; equal/stale/failed data stays pending; cache and single-flight recovery |
| Fastify/repository | Session isolation and reload; server-owned values; overlap prevention; conditional scoring exactly once; persistence failure and pending restart recovery |
| React Testing Library | Onboarding validation; loading/error/stale display; pending controls; result and score update; session restore |
| Playwright | One real browser journey through onboarding, submission, pending, resolution, score update, and reload against the real backend |

- Use injected clock and controlled provider observations for unit/API tests and
  the browser server fixture. Advance time without waiting a real minute; never
  depend on live Coinbase. Keep test controls in test-only fixtures, not endpoints
  or switches exposed by the deployed application.
- Run the browser against the actual frontend and Fastify app with an isolated,
  resettable store fixture. Prefer DynamoDB Local for genuine persistence evidence;
  if using an in-memory repository fixture, label that limitation and report
  separate real-database checks. Route mocks alone are not backend journey evidence.
- Install only missing RTL/DOM and Playwright tooling. Add documented scripts,
  browser installation/setup, fixture lifecycle/cleanup, and CI-friendly startup
  as needed. The starter Vitest config covers Node `src/**/*.test.ts`; include
  TSX/DOM tests with a suitable separate environment and keep maintained new
  tooling/source under Biome coverage. Keep browser tests out of Vitest discovery.

## Diagnostics — required

- Extend the gap matrix with deterministic assertions for meaningful classified
  failures and recovery across API, provider, repository, worker, and browser
  boundaries. Capture existing structured logs/console output with safe request/job
  correlation; assert appropriate levels and bounded/rate-limited repeated failures
  rather than requiring logs for every validation error, tick, or successful call.
- Seed recognizable sensitive values to prove cookie headers, credentials/digests,
  secrets, names, raw provider payloads, and unnecessary personal data are absent
  from diagnostics. Sanitize or omit unsafe failure reports/traces/screenshots and
  session storage; use minimal artifacts, not a new observability service/dependency.

## Contracts and handoffs

- Reuse T002–T005's real contracts and injectable seams; do not redesign runtime
  APIs for testing. Fixtures must not bypass the rule or conditional-write paths
  being asserted.
- Document the matrix, commands, fixture requirements, database evidence, and
  remaining gaps for [T007 — Deployment](T007-deploy-and-readme.md).

**Out of scope:** A large E2E suite, live market tests, production test controls,
and claiming database guarantees from mocks alone.

## Acceptance criteria

- [x] Every matrix row has named passing tests or an explicit reported gap; tests
  cover timing, equal/unavailable prices, scoring, overlap, and session persistence.
- [x] RTL exercises UI behavior and the focused Playwright journey uses a real
  backend with controlled time/provider data and an isolated store.
- [x] Tests are repeatable without live Coinbase or timing sleeps; fixtures clean
  up data/processes and cannot leak controls into production.
- [x] Test scripts/setup and actual-vs-mocked database evidence are documented.

- [x] Required diagnostics tests cover classification/correlation, bounded repeated
  failure and recovery, and secret/personal-data redaction across boundaries;
  failure artifacts are reviewed for safety.

## Verification to report

- Report named diagnostics/redaction assertions and their actual results, including
  safe artifact review and any uncovered boundary; do not attach sensitive fixtures.

- Actual `pnpm check`, `pnpm build`, and the newly documented Playwright command
  results, including browser/fixture setup and any skips or failures.
- The gap matrix and whether persistence/concurrency evidence used a real
  DynamoDB/DynamoDB Local store or only mocked/in-memory boundaries.

## Result (2026-10-06)

All acceptance criteria met; every matrix row has named passing evidence and none is
a reported gap. The matrix, fixtures, and actual-vs-mocked database evidence are in
[docs/testing.md](../testing.md).

- `pnpm check` — Biome 76 files, four TypeScript projects, Vitest 17 files / 210 tests passed.
- `pnpm build` — client Vite build and server `tsc` passed.
- `pnpm test:integration` — passed on real DynamoDB Local; now includes resolver
  restart recovery (fresh instance discovers a persisted guess and scores once) and a
  real missing-table `503 persistence_unavailable` check with no writes or leaks.
- `pnpm test:e2e` — 1 passed (~6.3s total; journey ~4.5s) against the real Fastify app
  and DynamoDB Local; isolated table removed, `btc-guesser-local` untouched, no live
  Coinbase. Playwright's clock drives the browser poll timer, and the client arms the
  pending 5s cadence at acceptance.
- Diagnostics/redaction: server, provider, repository, worker, React, and real-browser
  console assertions; seeded secrets/names absent; Playwright artifacts disabled.

Fixture: `tests/e2e/server.ts` is a test-only launcher (ports 3300/5373/3301) with a
loopback-only control channel and an injected ticker. `GUESS_MIN_WAIT_MS` is now a real
documented runtime setting (default 60000), so the journey exercises the real
acceptance-window path rather than a test-only store wrapper.

Remaining: live Coinbase health, AWS IAM, and the public deployment belong to T007.
