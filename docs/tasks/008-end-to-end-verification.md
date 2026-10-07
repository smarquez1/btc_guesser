# End-to-end verification

Depends on: 007.
Keep browser verification limited because end-to-end runs are slow. Unit tests own
the rule permutations; verify the critical integrated flow directly with Playwright.

## Acceptance criteria
- Verify initial load, player creation, BTC price, and score.
- Submit a guess, observe pending state, then verify result and persisted score.
- Verify reload persistence, one clear error state, and the desktop layout. Mobile/tablet verification is out of scope.
- Record evidence and limitations; do not duplicate the unit-test matrix in browsers.
- Avoid a broad end-to-end suite or CI setup unless separately requested.

## Validation and limitations

In progress. On 2026-10-07, the user explicitly requested one basic Playwright
success-path test before completing the coverage review. This authorizes the
focused test now; task 007 and the remaining verification criteria stay open.

- Added a Chromium test at 1440 × 900 for anonymous creation, initial price/score,
  higher-guess submission, disabled/selected pending controls, correct resolution,
  score +1, re-enabled controls, and identity/score persistence after reload.
- Uses real browser HTTP requests, Vite, Fastify, pricing cache, game services,
  and DynamoDB Local. Only the upstream price source is controlled to produce
  increasing prices with current timestamps. The production default remains
  Coinbase; no test-only HTTP route or alternate game rules are added.
- Advances backend and browser dates through the unchanged 60-second deadline
  using Node's built-in mock timers and Playwright's clock. Network and polling
  timers remain real. Confirms pending and score zero at 59 seconds, then correct
  resolution after advancing to 65 seconds, allowing any pre-deadline price cache
  to expire. Checks result evidence through the API and confirms the
  profile has score 1 and no pending guess after reload. Backend clock mocks are
  reset after each test, including failures.
- Each run creates and deletes its own unique local table with placeholder
  credentials. Test servers use ports 3001 and 5174; existing development servers
  and the application table are not used. Browser output is ignored by Git.
- Command: `mise exec -- pnpm test:e2e`, after installing Chromium with
  `mise exec -- pnpm exec playwright install chromium` and starting DynamoDB Local.
- First run exposed duplicate anonymous creation during React Strict Mode's
  effect replay. Added cancellation checks before creation and retry so a
  discarded effect cannot create another player.
- Validation on 2026-10-07: `mise exec -- pnpm test:e2e` passes the single
  Chromium happy-path test, including the real deadline and reload persistence.
  The sandbox initially blocked a local database connection; the successful run
  used approved access. Temporary table cleanup completed through the teardown.
  `git diff --check` passes. No lint, typecheck, formatter, unit/integration suite,
  or commit was run for this change.
- Error-state verification and broader visual review remain outstanding. No CI
  configuration or broad end-to-end suite was added, so task 008 stays in progress.
- Requested clock acceleration passes: one test in 5.1 seconds overall (3.9 seconds
  in the test), down from about 1.1 minutes overall. No additional dependency or
  production-code change was needed. `git diff --check` passes; no lint,
  typecheck, formatter, other test suites, or commit was run.
