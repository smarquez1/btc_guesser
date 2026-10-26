# Browser migration and React removal

Depends on: 016.

## Scope and acceptance criteria

- Adapt all existing Playwright scenarios to HTMX HTML requests and rendered state.
- Keep isolated Fastify servers, local tables, controlled clocks/prices, and
  per-test browser state.
- For UI submission, assert committed state through test fixtures/repositories or
  retained read-only diagnostics; do not parse HTML as JSON.
- Preserve lost-response, competing-tab, outage, browser-reopen, deadline/equality,
  invalid-cookie, result-ordering, accessibility/layout, and production scenarios.
- Remove React components/hooks, React dependencies/types/plugin, SPA entrypoint,
  and obsolete client orchestration after replacement tests pass.
- Remove unused JSON game endpoints only after migration coverage replaces their
  boundary assertions. Keep `/api/health`.
- Update production build checks to verify the real manifest, referenced assets,
  and missing-build startup failure.

## Validation plan

- Run focused browser scenarios, then the complete parallel suite.
- Verify production startup and serving through the actual server entrypoint.
- Keep local database tests isolated and reject nonlocal endpoints.

## Validation results

- Migrated Playwright helpers to read profiles and guesses directly from the
  isolated test repositories; UI actions now assert rendered HTML and persisted
  records rather than removed JSON endpoints.
- Removed React components, hooks, API client, entrypoint, test dependencies,
  React Vite plugin, and the old JSON player/price/guess routes. `/api/health`
  remains. Vite builds only the HTMX entry and styles; production verifies the
  real manifest, referenced assets, and missing-manifest startup failure.
- `mise exec -- pnpm exec playwright test tests/e2e` passed 10/10 scenarios.
- `mise exec -- pnpm test:integration` passed 9/9 scenarios with DynamoDB Local.
- `mise exec -- pnpm test` passed 67/67 unit tests; `mise exec -- pnpm build`
  passed typecheck and production asset build.
- Task complete; no commit made.
