# Repository guidance

This is a small interview assignment. Prioritize working end-to-end flow, correctness, readable structure, deployment, then UI polish. Skip optional work that does not improve the critical path.

This challenge targets desktop only. Use the 16:10 mockup as the reference; mobile/tablet layouts and verification are out of scope.

## Stack and layout

- Frontend: React, TypeScript, Vite, Tailwind, and shadcn/ui. Code in `src/`, static assets in `public/`.
- Backend: Fastify, TypeScript, DynamoDB, and Coinbase. Code directly under `server/`.
- Use pnpm and mise; tool versions live in `.tool-versions`. Keep dependency manifests and applicable lockfiles committed.
- Read `README.md` for setup, run, and deployment commands; update it when those commands or functionality change.

## Implementation rules

Prefer explicit, boring code, focused files, and small local React state. Apply DRY to shared behavior and business rules, not a few repeated lines. Add dependencies, folders, helpers, or layers only for a concrete need.

Keep the implementation easy to walk through from route to service to repository. Prefer small functions and explicit operations; do not add abstractions for hypothetical future needs.

Use routes for HTTP handling, services for business logic, repositories for explicit DynamoDB access, schemas for validation, and lib for small infrastructure helpers. Create folders only when needed. Keep genuinely shared domain types in types. Separate I/O from business logic where practical.

The backend owns validation, timestamps, prices, caching, resolution, and persistence. The frontend renders server state, collects input, and calls APIs. Never trust client-provided game state or timestamps.

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

Use anonymous identity with backend validation, cheap player-creation rate limiting, and TTL for ephemeral records. Never commit credentials or local environment files; document placeholders in `.env.example` and ignore secrets and generated output.

Avoid Redux, Zustand, queues, microservices, DI frameworks, generic repositories, custom design systems, and full authentication unless explicitly required. Prefer existing shadcn/ui primitives.

## Commits and checks

- Follow the workflow: implementation -> user approval -> requested tests -> commit.
  Add tests only when the user asks, after reviewing the implementation.

- Use Lefthook before commits to run Biome on staged files and `pnpm typecheck` (`tsc --noEmit`) on the whole project.
- Run lint and type checks only before committing or when the user explicitly asks. Do not run formatters unless explicitly asked.
- Add and run unit tests when the developer asks, before committing the related work. Keep most coverage fast and deterministic; add focused integration tests where real component interactions matter.
- Defer end-to-end tests to the final verification task. Use Playwright for direct verification of meaningful UI changes. CI remains deferred unless explicitly requested.
- Use focused commits with short imperative subjects. PRs explain purpose, link relevant issues, report validation and limitations, and include screenshots for visible changes.

## Task tracking

- Keep tasks as numbered Markdown files under `docs/tasks/`.
- Use [docs/tasks/index.md](docs/tasks/index.md) as the status index, with links to each task and statuses `todo`, `in-progress`, `blocked`, or `done`.
- Before starting work, read the relevant task and its dependencies, then mark it `in-progress` in the index.
- Maintain each task's scope, acceptance criteria, validation results, and limitations. Record the reason for any blocked task.
- Mark a task `done` only when its acceptance criteria are met and validation is recorded; keep the index current as work progresses.
- Follow the planned sequence: UI mockup, backend foundation, anonymous players, BTC pricing, guess lifecycle, game UI, test coverage review, focused end-to-end verification, then deployment. Complete unit tests before the end-to-end verification task.

## Task-specific guidance

The approved UI reference is [docs/ui.pen](docs/ui.pen), containing 16:10 ready and success mockups of one game screen. Inspect it with pen.dev before UI implementation. Keep the UI minimal: black, white, neutral grays, square buttons, and bottom help text. Reserve green/red for the price after a correct/incorrect guess. Show the player name beside the score (Steve is the mockup example). Keep both direction buttons visible, disable them while pending with the selected direction highlighted, and re-enable them after resolution. Show countdowns, results, loading, and errors inline; do not add separate game-state screens or a Try again action.

Read the relevant document before making changes:

- Backend, pricing, game rules, API behavior, or persistence: [docs/backend.md](docs/backend.md).
- UI design or implementation: [docs/ui.md](docs/ui.md). Use pen.dev before major screens, retain the `.pen` file, and verify the rendered implementation with Playwright.
- MCP usage or AWS inspection: [docs/tools.md](docs/tools.md).
