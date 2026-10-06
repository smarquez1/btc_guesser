# BTC Guesser

A small web app for guessing whether BTC/USD will be higher or lower after at least one minute. This README is the project overview during planning; before submission, expand it with the finished app’s setup, test, deployment instructions, and live URL.

## Local setup

Requires Node.js 24 and pnpm 12.9.1. From the project directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173 for the starter screen. Verify the API at
http://localhost:5173/api/health (through Vite's proxy), or directly at
http://127.0.0.1:3000/api/health. Both return `{ "status": "ok" }`.

**Implemented at T001:** React/Tailwind/shadcn starter, Fastify health endpoint,
production frontend serving, and developer checks. Player identity, persistence,
live pricing, and guessing are still planned; the starter button is disabled.
No AWS credentials, DynamoDB setup, or Coinbase access is needed to run this setup.

### Developer commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the API watcher and Vite together |
| `pnpm dev:server` | Start only the API watcher |
| `pnpm dev:client` | Start only Vite; run the API in another terminal |
| `pnpm test` / `pnpm test:watch` | Run deterministic backend tests once / watch |
| `pnpm lint` | Check formatting, lint rules, and imports with Biome |
| `pnpm format` | Format application source and tooling configs |
| `pnpm typecheck` | Check client, server, tests, and tooling TypeScript |
| `pnpm check` | Run lint, type checks, and tests |
| `pnpm build` | Type-check and build `dist/client` and `dist/server` |
| `pnpm start` | Serve the built frontend and API; run `pnpm build` first |

Installation enables Lefthook when Git is available. Pre-commit runs Biome's
safe fixes (`check --write`, never `--unsafe`) on staged TS/TSX/JS/JSX/JSON/CSS
files and re-stages the fixes, then runs project type checks for TS/TSX/JSON
changes. TypeScript errors block the hook; Biome does not repair arbitrary type
errors. Lefthook temporarily hides unstaged edits in partially staged files and
restores them afterward, keeping those edits out of the commit.

### Ports and configuration

| Setting | Default | Effect |
|---|---|---|
| Frontend dev port | `5173` | Vite; override with `pnpm dev:client --port 5174` |
| `PORT` | `3000` | Fastify port; keep `3000` for proxied development |
| `HOST` | `127.0.0.1` in dev; `0.0.0.0` for the built server | Fastify bind address |

Vite preserves `/api` and always forwards it to `http://127.0.0.1:3000`.
Run the development API on port 3000; neither `PORT` nor `HOST` changes the
proxy target. If port 3000 is occupied, free it before using proxied development.

For separate terminals (with a frontend-only port override if 5173 is occupied):

```sh
pnpm dev:server
# In another terminal:
pnpm dev:client --port 5174
```

For a local production-build check, run `pnpm build` then
`PORT=3100 pnpm start` and open http://localhost:3100. Fastify serves the built
assets and SPA navigation; unknown API routes and missing assets return 404.
This is a local run, not a public deployment.

### Code structure

| Path | Responsibility |
|---|---|
| `src/client/` | React starter, Tailwind CSS, and locally copied shadcn Button |
| `src/server/app.ts` | Testable Fastify factory, health route, and static serving |
| `src/server/index.ts` | Server startup, environment configuration, and shutdown |
| `src/server/app.test.ts` | Health, static assets, SPA, and API404 tests |
| `vite.config.ts` / `tsconfig*.json` | Frontend proxy, `@` client alias, and TypeScript build boundaries |
| `docs/` | Product/architecture decisions and task tracking |

## Required game behavior

- Always show the player’s score and the latest available BTC/USD price. If the provider is unavailable, show the last known price as stale rather than implying it is current.
- Let the player choose **Up** or **Down**.
- Allow only one unresolved guess per player.
- Do not resolve a guess before 60 seconds have elapsed.
- At or after 60 seconds, compare the starting price with the first fresh price observation received by the backend. If the values differ, resolve the guess; if they are equal or data is unavailable, keep it pending.
- Award `+1` for a correct guess and `−1` for an incorrect guess. New players start at `0`.
- Persist player scores and guess state in a backend data store.

The price comparison uses the provider’s full-precision values. The interface may round prices for display. A move before the 60-second mark counts if the price is still different when checked after the minimum wait.

## Player identity

Each player has a backend record, created with score zero and associated with a server-issued session cookie. Ask for a display name, but use the cookie—not the name—to identify the player’s requests. A name is a label, not an account or password. Remembering the player after closing the browser is optional.

## Planned stack

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Tailwind CSS |
| Components | Standard shadcn/ui components |
| Backend | Fastify + TypeScript modular monolith |
| Persistent data | AWS DynamoDB |
| BTC/USD data | Coinbase Exchange public market data |
| Hosting | Render free web service; AWS for persistent data |
| Tests and checks | Vitest, React Testing Library, a small Playwright suite, Biome, Lefthook |
| Agent guidance | Project-local `typescript-fastify` and `typescript-testing` skills; see [AGENTS.md](AGENTS.md) |
| Mockup | Basic layout mockup in pen.dev; no custom visual theme |

## Delivery plan

1. Create a basic layout mockup and set up the app and developer workflow.
2. Implement player identity, DynamoDB persistence, price retrieval, and guess resolution.
3. Build the game interface and verify the core rules with focused tests.
4. Deploy the demo and document how to run and deploy it.

### Nice to have

- Keep the player’s score and active guess available after they close and reopen the browser.
- Add a small leaderboard.

Complete and deploy the core game before taking on these optional features. Keep the project within roughly half a day of work.

## Project docs

- [Product scope](docs/product-and-scope.md)
- [Technical approach](docs/technical-approach.md)
- [Milestones](docs/milestones.md)
- **Task tracking:** [numbered Markdown task descriptions](docs/tasks/README.md); no GitHub Issues.

## Submission checklist

- [ ] Public Git repository.
- [ ] Deployed solution and public URL.
- [ ] README updated with functionality, local setup, tests, deployment steps, assumptions, and deployed URL.
