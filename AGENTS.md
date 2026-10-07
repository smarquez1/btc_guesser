# Repository guidance

This is a small interview assignment. Prioritize working end-to-end flow, correctness, readable structure, deployment, then UI polish. Skip optional work that does not improve the critical path.

## Stack and layout

- Frontend: React, TypeScript, Vite, Tailwind, and shadcn/ui. Code in `src/`, static assets in `public/`.
- Backend: Fastify, TypeScript, DynamoDB, and Coinbase. Code directly under `server/`.
- Use pnpm and mise; tool versions live in `.tool-versions`. Keep dependency manifests and applicable lockfiles committed.
- Read `README.md` for setup, run, and deployment commands; update it when those commands or functionality change.

## Implementation rules

Prefer explicit, boring code, focused files, and small local React state. Apply DRY to shared behavior and business rules, not a few repeated lines. Add dependencies, folders, helpers, or layers only for a concrete need.

Use routes for HTTP handling, services for business logic, repositories for explicit DynamoDB access, schemas for validation, and lib for small infrastructure helpers. Create folders only when needed. Keep genuinely shared domain types in types. Separate I/O from business logic where practical.

The backend owns validation, timestamps, prices, caching, resolution, and persistence. The frontend renders server state, collects input, and calls APIs. Never trust client-provided game state or timestamps.

## Game invariants

- Anonymous players start at zero and may have only one unresolved guess.
- Resolve only after at least 60 seconds using an eligible observation with a price different from the starting price. Equal prices remain pending.
- Correct guesses earn +1; incorrect guesses lose 1. Persist scores in DynamoDB.
- Preserve cached `observedAt`; reads never refresh it. Keep cache freshness separate from resolution eligibility.
- Prefer lazy/on-demand resolution. Store enough state to explain results deterministically and reuse shared rules across routes.
- Always display the score and latest available BTC/USD price.

## Scope and security

Use anonymous identity with backend validation, cheap player-creation rate limiting, and TTL for ephemeral records. Never commit credentials or local environment files; document placeholders in `.env.example` and ignore secrets and generated output.

Avoid Redux, Zustand, queues, microservices, DI frameworks, generic repositories, custom design systems, and full authentication unless explicitly required. Prefer existing shadcn/ui primitives.

Use Lefthook before commits to run Biome on staged files and `pnpm typecheck` (`tsc --noEmit`) on the whole project. Run lint and type checks only before committing or when the user explicitly asks. Do not run formatters unless explicitly asked. Automated tests, test infrastructure, and CI remain deferred; do not add or run them until explicitly requested. Verify the working flow directly; use Playwright for meaningful UI changes without creating a test suite.

## Task-specific guidance

Read the relevant document before making changes:

- Backend, pricing, game rules, API behavior, or persistence: [docs/backend.md](docs/backend.md).
- UI design or implementation: [docs/ui.md](docs/ui.md). Use pen.dev before major screens, retain the `.pen` file, and verify the rendered implementation with Playwright.
- MCP usage or AWS inspection: [docs/tools.md](docs/tools.md).

Use descriptive names, consistent indentation, focused commits, and short imperative commit subjects. PRs should explain purpose, link relevant issues, report validation and limitations, and include screenshots for visible changes.
