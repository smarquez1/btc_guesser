# Svelte frontend migration

Depends on: 006, 007, 008, 009, 010.

## Scope and acceptance criteria

- Replace the React frontend with an idiomatic Svelte 5 + TypeScript + Vite
  implementation; do not introduce SvelteKit.
- Preserve the existing desktop game UI, accessibility, API behavior, price and
  guess states, request recovery, and deployment architecture.
- Leave Fastify, DynamoDB, API contracts, and backend logic unchanged.
- Remove React dependencies and obsolete React-specific source and tests.
- Retain backend/API unit and integration coverage. Use existing Playwright E2E
  coverage for frontend behavior; add focused browser scenarios only for
  important uncovered behavior.
- Update Svelte tooling, project documentation, and repository guidance as
  needed. Keep migration isolated on `feat/svelte-migration`; do not deploy.

## Validation and limitations

- `pnpm lint`: passes.
- `pnpm typecheck`: `svelte-check` reports zero errors/warnings; TypeScript
  check passes. TypeScript 7 support in `svelte-check` requires the documented
  experimental TS-Go API plus both TypeScript 6 and 7 packages.
- `pnpm test`: all 81 retained backend/API tests pass. The 10 React/JSDOM
  component/hook tests were removed; focused game flows remain covered in E2E.
- `pnpm test:integration`: all 11 tests pass against DynamoDB Local.
- `pnpm build`: production frontend build passes.
- `pnpm test:e2e`: all 10 Playwright scenarios pass against built assets and
  isolated local fixtures. Added assertions for correct/incorrect result colors.
- `git diff --check`: passes. No formatter was run.
- E2E uses desktop Chromium, local DynamoDB, and controlled prices/clocks; it does
  not verify AWS, live Coinbase, or Render deployment. Deployment was out of scope.
