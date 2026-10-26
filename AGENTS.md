# Repository guidance

This is a small interview assignment. Prioritize working end-to-end flow, correctness, readable structure, deployment, then UI polish. Skip optional work that does not improve the critical path.

This challenge targets desktop only. Use the 16:10 mockup as a loose guide for layout and game states; matching its exact styling, spacing, or typography is not required. Prioritize minimal HTML and styling. Mobile/tablet layouts and verification are out of scope.

## Stack and layout

- Frontend: Fastify-rendered EJS HTML with HTMX, TypeScript, Vite, and Tailwind CSS. Keep markup and styling minimal; use semantic native HTML and small amounts of plain CSS. Browser code lives in `src/main.ts`; static assets in `public/`. Do not add a UI component library.
- Backend: Fastify, TypeScript, DynamoDB, and Coinbase. Code directly under `server/`.
- Use pnpm and mise; tool versions live in `.tool-versions`. Keep dependency manifests and applicable lockfiles committed.
- Read `README.md` for setup, run, and deployment commands; update it when those commands or functionality change.

## Implementation rules

For code changes, modify the target files directly. Never create temporary scripts (e.g. `modify.py`, `update.py`, `patch.py`) to perform edits.

Prefer explicit, boring code, focused files, and minimal browser state. Apply DRY to shared behavior and business rules, not a few repeated lines. Add dependencies, folders, helpers, or layers only for a concrete need.

Keep the implementation easy to walk through from route to service to repository. Prefer small functions and explicit operations; do not add abstractions for hypothetical future needs.

Use routes for HTTP handling, services for business logic, repositories for explicit DynamoDB access, schemas for validation, and lib for small infrastructure helpers. Create folders only when needed. Keep genuinely shared domain types in types. Separate I/O from business logic where practical.

The backend owns validation, timestamps, prices, caching, resolution, and persistence. Fastify renders HTML fragments; the browser submits native forms through HTMX and updates local countdown text only. Never trust client-provided game state or timestamps.

## Server-rendered UI and HTMX

- Keep `App.tsx`-style client-side screen state out of the browser. Fastify routes
  render HTML; EJS templates live in `server/views/`, and browser synchronization
  lives in focused HTMX behavior in `src/main.ts`.
- Keep presentation markup independent of database access. Routes handle HTTP,
  services assemble authoritative state and business rules, repositories own
  DynamoDB operations.
- Keep one stable HTMX synchronization root around the replaceable game fragment.
  Render current state from the server and use targeted fragment swaps.
- Separate independent polling and timers. Prevent overlapping requests,
  duplicate submissions, stale response updates, and obsolete work explicitly.
- Keep countdown updates local to their displayed element; do not poll more
  often than needed or rerender the whole screen every second.
- Preserve native forms, button semantics, focus behavior, labels, and accessible
  inline status/error announcements. Escape all EJS values by default.
- Prefer clear branches and small named functions over dense templates or generic
  client frameworks and helpers.

## Formatting and readability

- Use Biome for formatting and linting; do not add Prettier or ESLint.
- Biome preserves blank lines but cannot insert them, so apply the conventions below by hand.
- Separate distinct logical steps inside functions with a single blank line.
- Always add a blank line after guard clauses and early returns.
- Separate setup, validation, side effects, computation, and return statements when they form distinct logical blocks.
- Avoid dense blocks of consecutive statements even when Biome permits them.
- Use descriptive names and consistent indentation, and keep functions small and focused.

## Game invariants

- Anonymous players start at zero and may have only one unresolved guess.
- Resolve only after at least 60 seconds using an eligible observation with a price different from the starting price. Equal prices remain pending.
- Correct guesses earn +1; incorrect guesses lose 1. Persist scores in DynamoDB.
- Preserve cached `observedAt`; reads never refresh it. Keep cache freshness separate from resolution eligibility.
- Use integer Unix epoch seconds for all backend timestamps, including TTL. Convert to milliseconds only at JavaScript date/timer boundaries.
- Enforce one pending guess atomically; persist each resolution and score change together exactly once.
- Prefer lazy/on-demand resolution. Store enough state to explain results deterministically and reuse shared rules across routes.
- Always display the score and latest available BTC/USD price.

## Scope and security

Use anonymous identity with backend validation and TTL for ephemeral records.
Player creation has no rate limit, per the user's simplification request. Never
commit credentials or local environment files; document placeholders in
`.env.example` and ignore secrets and generated output.

Avoid Redux, Zustand, queues, microservices, DI frameworks, generic repositories, custom design systems, and full authentication unless explicitly required. Prefer native HTML controls and browser behavior; keep CSS focused on layout, readability, focus, and game-state feedback.

## Commits and checks

- Follow the workflow: implementation -> user approval -> requested tests -> commit.
  Add tests only when the user asks, after reviewing the implementation.

- Use Lefthook before commits to run Biome on staged files, `pnpm typecheck` (`tsc --noEmit`) on the whole project, all unit and integration tests, and the production build. Integration tests require DynamoDB Local and load `.env.example` with isolated temporary tables.
- Run lint and type checks only before committing or when the user explicitly asks. Do not run formatters unless explicitly asked.
- Add and run unit tests when the developer asks, before committing the related work. Keep most coverage fast and deterministic; add focused integration tests where real component interactions matter.
- Use the existing Playwright suite for critical integrated flows and direct verification of meaningful UI changes. Add E2E scenarios when requested; keep rule permutations in fast unit tests. CI remains deferred unless explicitly requested.
- Keep E2E tests independent under parallel execution: use per-test servers, tables, prices, clocks, and browser state. Let the OS assign server ports and use fixture URLs. Build the frontend once before workers start; write artifacts with `testInfo.outputPath()`. See README.md for run and repeat commands.
- Use focused commits with short imperative subjects. PRs explain purpose, link relevant issues, report validation and limitations, and include screenshots for visible changes.

## Deployment configuration

- Host the frontend and API together on one Render Node web service. Keep
  DynamoDB on AWS; do not introduce a separate frontend host or migrate storage.
- Follow README.md for Render commands and environment settings.
- Production serves dist and must fail startup if the frontend build is missing.
  Keep .node-version aligned with the Node version in .tool-versions.
- Keep local SSO credentials separate from Render's dedicated IAM user. Restrict
  deployed permissions to the application table; store credentials only in Render.
- Keep proxy trust disabled; player creation does not depend on visitor IPs.
- Tests load local defaults from `.env.example`, independently of private `.env`.
  If the shell exports DYNAMODB_ENDPOINT, ensure it points at the running
  DynamoDB Local instance for integration checks and commits. Never run tests against AWS.

## Task tracking

- Keep tasks as numbered Markdown files under `docs/tasks/`.
- Use [docs/tasks/index.md](docs/tasks/index.md) as the status index, with links to each task and statuses `todo`, `in-progress`, `blocked`, or `done`.
- Before starting work, read the relevant task and its dependencies, then mark it `in-progress` in the index.
- Maintain each task's scope, acceptance criteria, validation results, and limitations. Record the reason for any blocked task.
- Mark a task `done` only when its acceptance criteria are met and validation is recorded; keep the index current as work progresses.
- Follow the planned sequence: UI mockup, backend foundation, anonymous players, BTC pricing, guess lifecycle, game UI, test coverage review, focused end-to-end verification, then deployment. Complete unit tests before the end-to-end verification task.

## Task-specific guidance

Inspect [docs/ui.pen](docs/ui.pen) with pen.dev before major UI changes. Its 16:10
mockups are loose layout guides. Use black, white, neutral grays, square buttons,
and bottom help text. Show the server-generated name beside the score.

Keep both direction buttons visible: green `GUESS HIGHER` and red `GUESS LOWER`.
While pending, disable both and fill the selected button with its direction color;
keep the other outlined. Re-enable both after resolution. Color the result price
green/red for correct/incorrect guesses. Show countdowns, results, loading, and
errors inline; do not add separate state screens or a Try again action.

Read the relevant document before making changes:

- Backend, pricing, game rules, API behavior, or persistence: [docs/backend.md](docs/backend.md).
- UI design or implementation: [docs/ui.md](docs/ui.md). Use pen.dev before major screens, retain the `.pen` file, and verify the rendered implementation with Playwright.
- MCP usage or AWS inspection: [docs/tools.md](docs/tools.md).
