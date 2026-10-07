# BTC Guesser

A small web app for guessing whether BTC/USD will be higher or lower after at least one minute. This README is the project overview during planning; before submission, expand it with the finished app’s setup, test, deployment instructions, and live URL.

## Local setup

Requires Node.js 24 and pnpm 12.9.1. From the project directory:

```sh
pnpm install --frozen-lockfile
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose up -d dynamodb
pnpm db:setup
pnpm dev
```

Review `.env` before starting; preserve existing values rather than overwriting it.
For the Compose service, use `DYNAMODB_ENDPOINT=http://127.0.0.1:8000`,
`DYNAMODB_TABLE=btc-guesser-local`, and `AWS_REGION=us-east-1`.
`.env` and other `.env.*` files are Git-ignored; `.env.example` is explicitly
excluded from that ignore rule and should be committed as the setup template. Keep only
safe sample values in the template, never real credentials.

Open http://localhost:5173 for the starter screen. Verify the API at
http://localhost:5173/api/health (through Vite's proxy), or directly at
http://127.0.0.1:3000/api/health. Both return `{ "status": "ok" }`.

**Backend:** session identity, DynamoDB player/active-guess persistence, shared
Coinbase pricing, and background guess resolution/scoring. Interface integration
remains separate work. Runtime guess submission requires trusted pricing and
returns `price_unavailable` without writes during degradation; there is no
placeholder price. `/api/health` is a liveness check and never probes DynamoDB,
so health and static serving work without database config in development and the
default `buildApp()`; player operations return `persistence_unavailable` in that
case. A production run (`pnpm start` or a deployed service) requires
`DYNAMODB_TABLE` and refuses to start without it.

### DynamoDB Local

The quick start requires Docker (on this Mac, Colima). If `DOCKER_HOST` overrides
the active context, use `docker --context colima compose up -d dynamodb` explicitly.
`pnpm db:setup` waits up to 20 seconds, creates the configured table if absent,
and never resets existing data. It uses the SDK; AWS CLI is not required.
Stop with `docker compose stop dynamodb` (or the explicit Colima context).
The named volume retains data; do not use `down -v` unless intentionally deleting it.

`pnpm dev:server`, `pnpm start`, `pnpm db:setup`, and `pnpm test:integration` load
`.env` using Node 24's built-in support. Do not commit `.env` or credentials.

| Setting | Purpose |
|---|---|
| `DYNAMODB_TABLE` | Required player table; suggested local name is `btc-guesser-local` |
| `DYNAMODB_ENDPOINT` | Local loopback URL, normally `http://127.0.0.1:8000`; omit for AWS |
| `AWS_REGION` | Standard AWS region configuration; loopback client defaults to `us-east-1` |

Dummy credentials are supplied only with an explicitly configured loopback local
endpoint. AWS uses the SDK's standard region/credential chain; no runtime memory
fallback exists. Do not add real AWS keys for local development; non-loopback
`DYNAMODB_ENDPOINT` values are rejected. The table has a string partition key
`playerId` and no sort key.
For AWS, provision the table separately and grant the app only `dynamodb:GetItem`,
`dynamodb:PutItem`, and `dynamodb:UpdateItem` on that table. Local setup additionally
uses DescribeTable/CreateTable; the isolated integration command uses DeleteTable.

### Player API contract

All player responses use `Cache-Control: no-store`. Successful responses share:

```json
{"id":"server-generated UUID","displayName":"Ada","score":0,"activeGuess":null,"latestGuess":null,"pricing":{"status":"unavailable","observation":null}}
```

| Operation | Request | Success |
|---|---|---|
| `POST /api/players` | `{"displayName":"Ada"}` | 201 new player; 200 existing valid session without resetting progress |
| `GET /api/player` | Session cookie | 200 player state |
| `POST /api/guesses` | `{"direction":"up"}` or `{"direction":"down"}` | 201 updated player state |

Names are trimmed, must be nonempty, and are limited to 80 UTF-16 code units after
trimming. Extra request fields are rejected. Matching names are not authentication.
The `btc_player` cookie contains a private random credential alongside the public
ID; only a digest is stored. It is HttpOnly, SameSite=Lax, Path=/, Secure in
production, with no Max-Age/Expires. Losing the cookie loses access to the player.
The same cookie and DynamoDB store restore state after reloads or backend restarts;
this is not a password login or guaranteed identity after closing the browser.

A pending guess contains `id`, `direction`, exact decimal-string `startingPrice`,
and epoch-millisecond `acceptedAt`/`eligibleAt` (acceptance + 60,000). All are
server-owned except direction. `startingPrice` is the current trusted price at
acceptance. Once resolved, `latestGuess` adds `result`
(`correct`/`incorrect`), `scoreDelta` (`1`/`-1`), `resolvedAt`, and the resolving
observation's exact `observedPrice`/`observedAt` (server receipt time). Scoring is
server-owned; the interface must not apply a local score change. Acceptance
atomically requires an existing player with no active guess; concurrent
submissions cannot overwrite an active guess. Unavailable prices write no guess.

Errors are JSON `{"error":"code"}`: 400 `invalid_display_name`,
`invalid_direction`, or `invalid_body`; 401 `unauthorized`; 409 `active_guess`;
413 `payload_too_large`; 415 `unsupported_media_type`; other framework client
errors retain their status with `invalid_request`; 503 `price_unavailable` or
`persistence_unavailable`. Database failures are not
reported as conflicts and private credentials never appear in JSON.

Player diagnostics log only fixed event/category/operation fields and server-issued
request IDs. Unexpected storage/request failures use error level; missing config
or unavailable/failed trusted prices use warning level. Repeats are limited to
one failure per operation per minute per app instance; a successful operation
logs one recovery. Healthy reads do not falsely announce recovery of failed
writes. Routine validation/auth/conflict responses and successful operations do
not add application logs. Automatic request logs are disabled; request/error
serializers omit client URLs, headers, IPs, names, credentials, and raw errors.
Seeded-secret logger tests verify categories, correlation, suppression and recovery.

### BTC pricing — T003 handoff

The runtime uses unauthenticated `GET
https://api.exchange.coinbase.com/products/BTC-USD/ticker`. Coinbase `price` is
retained as an exact string; `time` is the **last trade timestamp**, not a response
generation timestamp or a promise of freshness. No API key or new environment
knobs are needed. These are application policies, not Coinbase guarantees:

| Policy | Default |
|---|---|
| Cache lifetime | 5 seconds (hits never renew receipt time) |
| Poll interval | 5 seconds after the preceding operation finishes |
| Provider timeout | 3 seconds total, including body parsing |
| Failure retry cooldown | 5 seconds after failure; no request-triggered tight retry |
| Trusted server receipt age | At most 15 seconds |
| Trusted last trade age | At most 120 seconds; at most 5 seconds in the future |
| Decimal validation | Positive plain decimal, at most 128 characters; no exponent/sign/whitespace |
| Provider timestamp | Valid UTC ISO date-time with `Z`, optional 1–9 fractional digits; impossible dates rejected |

One process-wide service shares an in-flight operation across routes/polling. A new
valid HTTP response records a new server receipt even if price and trade time are
identical; reading the cache never changes it. Polling begins in Fastify's
`onReady`; `app.close()` aborts the operation and clears timeout/poll timers. The
timeout settles callers even if a transport ignores abort; late results cannot
overwrite the cache. An uncooperative transport itself cannot be forcibly stopped.

Successful responses from all three existing player routes add `pricing`:

```json
{"status":"fresh","observation":{"price":"63123.123456789","providerTradeAt":"2026-10-06T00:00:00.123456Z","receivedAt":1791244800125}}
```

`fresh` means both age policies hold and no provider failure has occurred since
that observation. `stale` retains last-known data after failure/expiry; `unavailable`
has `observation: null` because no valid data has been obtained. Display may round
the price, but must label stale data and must not invent a current price. The
injected trusted callback returns `PriceObservation | null`; display data is a
separate callback and is never a substitute for trusted data. The default testable
`buildApp()` has unavailable pricing and does not fetch Coinbase.

For T004, check the trusted observation's **server `receivedAt`** against the guess
deadline. A pre-deadline cache hit is not eligible, but a newly received identical
ticker can be. `providerTradeAt` is context/freshness validation, **not** an
additional deadline condition. `comparePrices` compares differing precision and
leading zeros exactly without floating-point price conversion. Scoring/resolution
are not implemented by T003.

Pricing diagnostics use safe generated job IDs, category, elapsed/receipt age,
and retry delay. Failures/expiry warn at most once per 60 seconds; recovery logs
info. There are no routine cache-read/poll logs and no raw payloads, external
exception text, names, or cookies in pricing logs. Deterministic tests inject
fetch/time, use fake timers, and capture seeded-secret diagnostics; they never
contact Coinbase. Local checks do not establish live provider/deployment health.

### Guess resolution — T004

Resolution is a pure rule separate from Fastify, storage, and scheduling
(`src/server/resolution.ts`). A guess is eligible only when server time and the
trusted observation's `receivedAt` are both at or after `eligibleAt`, and the
observation is still fresh at decision time; the provider trade timestamp is
context, not the deadline condition. Full-precision values are compared exactly:
equal prices keep the guess pending, and the latest fresh observation at check
time decides `correct` (`+1`) or `incorrect` (`−1`). Stale or
unavailable observations never resolve a guess, and a move before the deadline
counts if the price is still different when checked after it.

A bounded in-process resolver (`src/server/resolver.ts`) starts with the app when
both persistence and pricing are configured. It runs one sweep every 5 seconds
after the previous sweep settles (never overlapping), discovers due guesses, reads
one shared trusted observation per sweep, and attempts one conditional write per
differing guess. The write pins `activeGuess.id`, adds the score delta, clears the
active guess, and stores the resolved `latestGuess` atomically, so repeated or
concurrent attempts and obsolete guesses get an expected `ObsoleteGuessConflict`
and cannot score twice or resolve a replacement. Equal prices and provider
failures leave the guess pending for a later sweep.

Discovery is a demo-scale DynamoDB scan: one page per sweep with an internal
cursor that carries across sweeps and restarts. `Limit` bounds evaluated items per
page (the filter runs after it), so a whole-table sweep costs O(n) per cycle at
demo scale; no GSI, queue, or Lambda is added. The first sweep after start
recovers pending guesses from DynamoDB rather than memory, so a backend restart or
a Render free-tier sleep only delays resolution until the service wakes.
`app.close()` stops scheduling and awaits in-flight work before pricing closes,
and the persistence client closes after those hooks settle.

Resolver diagnostics log start/stop, the first recovery sweep, and rate-limited
degraded/recovered events per operation (discovery, provider, resolution) with
fixed fields, bounded counts, elapsed time, and retry delay; expected obsolete
conflicts aggregate at info level. Raw errors, records, identifiers, prices, and
provider payloads are never logged. `pnpm test:integration` verifies due
discovery, atomic scoring, and no double counting under concurrent resolution
against DynamoDB Local; deterministic tests cover timing boundaries, pre-deadline
moves, equal/stale/unavailable prices, both directions, retries, restart recovery,
and shutdown without live prices or real-minute waits.

### Persistence verification

`pnpm check` runs deterministic Fastify/Vitest session, validation, concurrency,
resolution, worker, and SDK command-contract tests without DynamoDB, AWS, or
Coinbase.
`pnpm test:integration` explicitly requires a running local endpoint; it fails
if configuration/service is missing. It creates a unique test table, verifies
real conditional-write concurrency and cookie/state continuity across app
instances, checks due discovery plus atomic scoring with no double counting under
concurrent resolution, then deletes only that test table. It never deletes the
development table. Test prices are injected observations, not a runtime provider.
This local check does not verify AWS IAM or deployment.

### Developer commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the API watcher and Vite together |
| `pnpm dev:server` | Start only the API watcher |
| `pnpm dev:client` | Start only Vite; run the API in another terminal |
| `pnpm test` / `pnpm test:watch` | Run deterministic backend tests once / watch |
| `pnpm db:setup` | Create the configured local table if absent; preserve existing data |
| `pnpm test:integration` | Verify persistence against running DynamoDB Local using an isolated test table |
| `pnpm lint` | Check formatting, lint rules, and imports with Biome |
| `pnpm format` | Format application source and tooling configs |
| `pnpm typecheck` | Check client, server, tests, and tooling TypeScript |
| `pnpm check` | Run lint, type checks, and tests |
| `pnpm build` | Type-check and build `dist/client` and `dist/server` |
| `pnpm start` | Serve the built frontend and API; run `pnpm build` first |

Installation enables Lefthook when Git is available. Pre-commit runs serially: Biome's
safe fixes (`check --write`, never `--unsafe`) on staged TS/TSX/JS/JSX/JSON/CSS
files and re-stages the fixes, then runs project type checks for TS/TSX/JSON
changes, followed by `pnpm test` and `pnpm test:integration` on every commit,
regardless of file type. Integration requires a running loopback DynamoDB Local
service and `DYNAMODB_ENDPOINT` configured via `.env` or the environment (see
local setup above); missing configuration or a stopped service blocks the hook.
It creates and deletes only a unique test table, not the development table.
Check or test failures block the hook; Biome does not repair arbitrary type
errors. Lefthook temporarily hides unstaged edits in partially staged files and
restores them afterward, keeping those edits out of the commit.

`tsconfig.json` is an editor solution referencing client, server, and tooling
projects; shared strict options live in `tsconfig.base.json`. `pnpm typecheck`
checks each split project explicitly. Use the workspace TypeScript version and
restart the editor language server after configuration changes; preserve the
server's NodeNext ESM settings and top-level await.

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
| `src/server/resolution.ts` / `resolver.ts` | Pure guess rules and the bounded background resolver |
| `src/server/app.test.ts` | Health, static assets, SPA, and API404 tests |
| `vite.config.ts` / `tsconfig*.json` | Frontend proxy, `@` client alias, and TypeScript build boundaries |
| `docs/` | Product/architecture decisions and task tracking |

## Required game behavior

- Always show the player’s score and the latest available BTC/USD price. If the provider is unavailable, show the last known price as stale rather than implying it is current.
- Let the player choose **Up** or **Down**.
- Allow only one unresolved guess per player.
- Do not resolve a guess before 60 seconds have elapsed.
- At or after 60 seconds, compare the starting price with the latest fresh price observation received by the backend. If the values differ, resolve the guess; if they are equal or data is unavailable, keep it pending. Resolution is checked on a poll cadence, so a move that appears and reverts between checks may not decide a guess.
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
