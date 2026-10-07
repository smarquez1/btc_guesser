# Project instructions

## Read before working

Read these sources before planning or implementing a task:

| Source | Responsibility |
|---|---|
| `docs/product-and-scope.md` | Game behavior, player identity, UX requirements, and scope boundaries |
| `docs/technical-approach.md` | Architecture, technology choices, and reliability tradeoffs |
| `docs/tasks/README.md` | Task order and current status; follow its linked prompt for the assigned task |
| `docs/testing.md` | Test gap matrix, fixtures, and actual-vs-mocked evidence |
| `docs/mockup.pen` | Game interface design reference; inspect with pen.dev tools when working on the UI |

Keep product and architecture decisions in those documents, not in this file. If a task conflicts with them, clarify the conflict before implementing it.

### Game rules

- The player can at all times see their current score and the latest available BTC price in USD
- The player can choose to enter a guess of either “up” or “down“
- After a guess is entered, the player cannot make new guesses until the existing guess is resolved
- The guess is resolved when the price changes and at least 60 seconds have passed since the guess was made
- If the guess is correct (up = price went higher, down = price went lower), the user gets 1 point added to their score. If the guess is incorrect, the user loses 1 point.
- Players can only make one guess at a time
- New players start with a score of 0

## Working rules

- Keep changes focused on the assigned task and follow existing project conventions.
- Track work in `docs/tasks/`; update status after reviewing and verifying the work. Do not create GitHub Issues for project tracking.
- Prefer the smallest implementation that meets the documented requirements. Do not expand scope or add dependencies without a clear need.
- Comment sparingly on non-obvious rationale, invariants, or tradeoffs that code alone does not convey. Avoid narrating obvious code, and keep comments accurate when behavior changes.

## Implementation and verification

- Use the project-local `typescript-fastify` skill for Fastify work and `typescript-testing` for TypeScript/Vitest tests when relevant. These are guidance, not mandates: this file, the existing code, and current official docs take precedence. Do not add TypeBox, MSW, or other dependencies only because a skill demonstrates them.
- Use Biome for formatting/linting and Lefthook for fast local checks.
- Use Vitest for game rules and backend behavior, React Testing Library for UI behavior, and a small Playwright suite for the main browser journey; the browser suite lives in `tests/e2e/` — read `tests/e2e/AGENTS.md` before changing it.
- Make tests deterministic with injected time and price data. Do not depend on live Coinbase responses or wait a real minute in tests.
- Run the relevant checks for each change and report what ran and what passed.
- Do not mark tasks complete or claim deployment, a public repository, or final documentation exists without verifying it. Follow the deployment task for the final README requirements.

### Test authoring during iteration

- Do not author new tests while a feature's behavior or UI is still being iterated
  or awaiting user acceptance. In that phase, implement and verify manually
  (browser/CLI) and keep moving; do not add a test suite for behavior that is
  still changing.
- Add or update the deterministic tests for a change only once the user has
  accepted the behavior and the work is being prepared for commit. The pre-commit
  hook still runs the full suite, so the tests must exist and pass before commit.
- When tests are deferred, say so explicitly and list the tests still owed so they
  are not lost. Updating an existing test that no longer compiles (for example a
  changed action shape) is not "new test authoring" and should still be done.

### Linting and checks during iteration

- Do not run linters or formatters (Biome) proactively while a feature is still
  being iterated. Lefthook runs Biome on commit and re-stages safe fixes, so
  formatting/lint issues are handled there.
- Defer full type checks and the test suite to commit time as well (Lefthook runs
  them), unless an error actually blocks the current work.
- Run lint/type checks only when the user asks, or when a failure prevents the app
  from running.

## Developer workflow

- Use Node.js 24 and pnpm only. Keep `packageManager` pinned to `pnpm@12.9.1`; commit `pnpm-lock.yaml`, not npm or Yarn lockfiles.
- Install the recorded dependencies with `pnpm install --frozen-lockfile`. When intentionally changing dependencies, update the pnpm lockfile and keep build-script approvals narrowly scoped.
- For local persistence, copy `.env.example` to `.env` only if `.env` is missing; preserve existing values and never print secrets. `.env`/`.env.*` are ignored, with `.env.example` explicitly excepted; commit only safe sample values in that template, never real credentials.
- Follow README local setup: Compose binds DynamoDB Local to `http://127.0.0.1:8000`; configure `DYNAMODB_ENDPOINT`, `DYNAMODB_TABLE`, and `AWS_REGION`, then run `pnpm db:setup`. It creates a missing table without resetting existing data. Do not start infrastructure or delete volumes without authorization.
- The server, database setup, and integration commands load `.env`. Local loopback clients supply dummy credentials internally; do not add real AWS keys for local development. For AWS, omit `DYNAMODB_ENDPOINT` and use the standard SDK credential/configuration chain; see README for permissions.
- Start both development servers with `pnpm dev`; see README for separate-server commands and port overrides.
- Keep the development API on port 3000: Vite's `/api` proxy is fixed to `http://127.0.0.1:3000`. `PORT`/`HOST` still configure Fastify, including production runs.
- Pre-commit runs serially: Biome safe fixes (`check --write`, no `--unsafe`) on matching staged files and re-staging, project type checks for TS/TSX/JSON changes, then unconditional `pnpm test` and `pnpm test:integration` when the staged files include TS/TSX/JS/JSX/JSON. Documentation-only commits (`*.md`) skip integration so they do not require a running database. Lefthook preserves unstaged edits in partially staged files; check/test failures block the hook.
- Integration requires a configured, running loopback DynamoDB Local service whenever it runs (code commits, not docs-only). It creates a unique test table and cleans up only that table, never the development table. Report missing configuration/service as a blocker; do not silently skip it or claim mocked tests verify persistence.
- Run `pnpm check` (Biome, TypeScript, Vitest) and `pnpm build` for setup or integration changes. Report their actual results before marking work complete.
- `pnpm test:e2e` runs the focused Playwright journey against the real app and an isolated DynamoDB Local table. It needs a running DynamoDB Local and a one-time `pnpm exec playwright install chromium`; it is intentionally not part of pre-commit (keep commits fast) and is not a substitute for `pnpm test:integration`; see `tests/e2e/AGENTS.md`.
- Diagnose TypeScript errors with `pnpm typecheck` and formatting/lint issues with `pnpm lint`. Fix the underlying cause rather than weakening strict mode or adding blanket suppressions; add lint rules only for demonstrated problems. When adding maintained source or tooling files, keep Biome's `files.includes` coverage current.
- `tsconfig.json` is the root editor solution; split client/server/tools projects extend `tsconfig.base.json`. Keep strict options shared and server NodeNext ESM settings intact. Use workspace TypeScript and reload the language server after config changes rather than removing valid top-level await to mask project-selection errors.
