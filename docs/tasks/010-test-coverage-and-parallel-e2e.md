# Expanded test coverage and parallel E2E

Depends on: 007, 008, 009.

## Scope and acceptance criteria

- Recover a committed submission whose HTTP response is lost.
- Converge competing tabs on one pending guess and one score change.
- Recover polling after a connection interruption across the deadline.
- Exercise the actual production entrypoint, assets, cookies, and pending reload;
  reject startup when the build is missing.
- Verify transaction rollback when the profile condition fails.
- Exercise stale, expired, and recovered pricing through the game API and storage.
- Replace an invalid identity cookie without repeated player creation.
- Cover correct down/incorrect up outcomes and cumulative scoring across rounds.
- Keep changed pre-deadline observations pending until eligible evidence arrives.
- Keep setup and actions readable with focused shared fixtures and helpers.
- Load local defaults from `.env.example`; allocate server ports automatically.
- Build the frontend once before two parallel workers start.
- Isolate mutable state and screenshots per test; verify repeated execution and
  compare timing with the sequential suite.

## Implementation

Completed on 2026-10-09 at the user's request. Added eight E2E tests and three
DynamoDB integration tests; retained and refactored the two existing browser tests.
Parallelization remains part of this task, as requested.

- `tests/e2e/global-setup.ts` builds the production frontend once before workers
  start, with private Vite environment-file loading disabled. Workers only read
  the completed build.
- `tests/e2e/fixtures.ts` creates a Fastify server, unique local table, controlled
  upstream price source, and mocked backend Date per test. Socket and polling
  timers remain real. Shared actions/assertions cover submission, pending
  controls, results, and profiles.
- Game servers bind to port zero. Their assigned addresses become the allowed
  Origin and browser base URL, including persistent browser contexts. Fastify
  serves frontend assets and API together; no Vite dev server or proxy is needed.
- `workers: 2` and `fullyParallel: true` permit scenarios in the same file to
  run concurrently. Each worker process owns its clock; tests do not share tables,
  price caches, cookies, or servers.
- Production checks spawn the real `server/index.ts` with `NODE_ENV=production`.
  Because configuration requires a positive port, the helper asks the OS for
  an available port before starting the child and retries address-in-use failures
  up to twice. Readiness requires that child's listening log before checking
  health. A seeded local cache avoids live Coinbase requests.
- Missing-build verification uses a temporary copy of the actual server and
  package metadata, leaving the workspace build in place for other tests.
- Recovery tests forward submissions to the backend before dropping a response,
  synchronize competing tabs before releasing requests, interrupt browser API
  traffic across the deadline, and exercise real cookie replacement.
- Integration tests verify complete rollback when the profile points at another
  guess, stale-price submission refusal, eligible stale resolution, and pending
  preservation/recovery after pricing expires during an outage.
- Node test commands load `.env.example` instead of private `.env`. Shell
  overrides retain precedence. Database helpers reject nonlocal endpoints, use
  placeholder credentials and unique tables, and delete tables during teardown.
- Screenshots use `testInfo.outputPath()` so repeats and retries have separate
  evidence. Run commands and environment behavior are documented in README.md;
  AGENTS.md and UI guidance describe the isolation requirements.

## Original-rule coverage

| Requirement | Browser evidence |
| --- | --- |
| Score zero and latest USD price | Initial-load assertions; price and score stay visible while pending and during outages |
| Up/down and all scoring outcomes | Higher/correct, lower/incorrect, and consecutive lower/correct plus higher/incorrect rounds |
| One unresolved guess | Disabled controls, real duplicate 409, competing tabs converging on one pending ID |
| At least 60 seconds and a price change | Pending at 59 seconds, equal-price waiting after the deadline, rejection of changed pre-deadline observations |
| Fair source evidence | Final observation timestamp at/after the deadline; controlled upstream passes through the real price service/cache |
| Backend score persistence | Profile reads and reload assertions after wins, losses, and cumulative rounds |
| Optional browser return | Chromium close/reopen preserves identity and pending state; resolution enables further play |

## Validation and limitations

- `mise exec -- pnpm test:e2e`: all 10 scenarios pass with two workers in 29.2
  seconds, compared with the preceding 51.7-second sequential run (about 44% less
  elapsed time). The comparison includes all setup changes, including built assets.
- `mise exec -- pnpm test:e2e --repeat-each=2`: all 20 executions pass in 54.0
  seconds. The frontend builds once for the full run; both repetitions produce
  separate pending/incorrect/error screenshots.
- `mise exec -- pnpm test:integration`: all 11 tests pass in about three seconds
  after the shared database-helper update.
- `mise exec -- pnpm test`: all 91 unit/API/frontend tests pass in the final
  pre-commit validation after user approval.
- Initial sandbox attempts could not open local sockets or launch Chromium;
  approved local access enabled successful runs.
- An earlier Vite-based run reloaded the page during a simulated outage. The
  final suite serves built assets and has no dev-server file watcher or HMR.
- After user approval, `pnpm lint`, `pnpm typecheck`, all unit/integration tests,
  and `pnpm build` pass. Integration checks explicitly use
  `DYNAMODB_ENDPOINT=http://127.0.0.1:8000`.
- `git diff --check` passes, including the documentation cleanup. No formatter
  was run. The requested commit uses the required Lefthook checks.
- These tests use desktop Chromium, real application/storage interactions, and
  controlled prices. They do not establish live Coinbase availability, AWS service
  behavior, or Render deployment health. The deployed URL remains in README.md.
  Production application code was unchanged. CI and mobile remain out of scope.
