# Test coverage review

Depends on: 005, 006.
Most automated coverage should be fast, deterministic unit tests. Keep setup small;
isolate time, Coinbase, and DynamoDB I/O without introducing architectural layers.
Add unit tests when requested during implementation, before related commits.
This task reviews accumulated coverage and fills critical gaps before end-to-end
verification; it does not gate earlier unit or integration tests.

## Acceptance criteria
- Cover the 60-second boundary, pre-deadline observations, and equal-price pending.
- Cover both directions, correct/incorrect scoring, and initial score zero.
- Cover preserved cached observedAt and freshness versus resolution eligibility.
- Cover expiry checks while expired records still exist awaiting TTL cleanup.
- Cover invalid inputs/identity, one-pending-guess enforcement, and repeat resolution.
- Exercise concurrency safeguards where practical; identify anything requiring
  integration verification rather than claiming unit tests prove DynamoDB behavior.
- Cover meaningful UI state behavior where it adds value.
- Document and run the unit-test command; avoid real network calls and timed waits.

## Validation and limitations

Foundation coverage was added with task 002: configuration unit tests, Fastify
injection integration tests, and optional local DynamoDB integration tests.
Commands and validation are recorded in README and task 002. Game and UI coverage
remain pending until those features exist; this task remains todo.

Task 003 also adds five player-service unit tests, six Fastify player-route tests,
and two real DynamoDB tests for persistence and concurrent creation limits.
All 33 unit/route tests and five local DynamoDB tests passed on 2026-10-07.
The anonymous-player coverage is recorded in task 003; game and UI review remains
pending, so this task stays todo.

Task 004 adds 18 deterministic Coinbase/pricing/route tests and two DynamoDB
integration tests for trade ordering, freshness updates, and explicit expiry.
All 51 unit/route tests and seven local DynamoDB tests pass on 2026-10-07.
Game and UI coverage review remains pending; this task stays todo.

## Coverage review on 2026-10-07

The user approved the UI implementation and requested missing tests. Reviewed
existing backend unit/API/repository and real DynamoDB integration coverage.

- Existing tests cover the 60-second boundary, equal/ineligible/future observations,
  both directions and scoring outcomes, score zero, preserved observations,
  freshness versus eligibility, expiry before TTL cleanup, validation/identity,
  one pending guess, repeated resolution, and transaction retries.
- Real DynamoDB integration tests cover concurrent submission/resolution across
  app instances, exactly-once scoring, transaction rollback, and cache ordering.
  Unit tests alone do not establish those storage guarantees.
- Added nine request/recovery tests in `tests/game-api.test.ts`: request semantics,
  safe API errors, identity reuse/replacement, cancellation before creation,
  cross-tab results and score refresh, expired evidence handling, stale responses,
  and failure propagation without unexpected player creation.
- Added nine frontend tests in `tests/frontend.test.ts` using jsdom, React `act`,
  mocked fetch and fake clocks. Covers duplicate submission during polling,
  stale-response rejection, cross-tab resolution, uncertain-submit recovery,
  Strict Mode creation cancellation, retries, polling overlap/cleanup including
  unmount during a request, epoch-second countdown behavior, and result price
  color reset. Added jsdom and its types; retained the existing Node test runner.
- `mise exec -- pnpm test`: all 91 tests pass in about 1.2 seconds, including
  18 new frontend/request tests. No real network calls or timed waits are used.
- `git diff --check` passes. No formatter, lint, typecheck, or commit was run.
- `mise exec -- pnpm test:integration`: all eight real DynamoDB Local integration
  tests pass in about four seconds using isolated temporary tables and teardown.
  The application table is untouched.
- Coverage-review acceptance criteria are met; task 007 is done. Remaining browser
  error-state and desktop visual checks belong to tasks 006/008; no broad browser
  suite or CI was added.
- Review follow-up: added two regressions for example/dev-origin consistency
  and immediate result-price highlighting before the next live-price poll.
  All 93 unit/API tests pass; the existing Playwright happy path also passes.
