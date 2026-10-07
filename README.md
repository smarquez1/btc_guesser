# BTC Guesser

A small web app for guessing whether BTC/USD will be higher or lower after at least one minute. Public repository: [github.com/smarquez1/btc_guesser](https://github.com/smarquez1/btc_guesser). Live demo: [btc-guesser.onrender.com](https://btc-guesser.onrender.com). This README covers the app’s local setup, tests, API contracts, and deployment steps. See [Deployment status and open items](#deployment-status-and-open-items) for what remains.

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
placeholder price. Health/static serving work without database config;
player operations return `persistence_unavailable` in that case.

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
`dynamodb:PutItem`, `dynamodb:UpdateItem`, and `dynamodb:Scan` on that table
(`Scan` is the resolver's due-guess discovery). Local setup additionally
uses DescribeTable/CreateTable; the isolated integration command uses DeleteTable.
The full runtime policy and deployment steps are in [Deployment](#deployment) below.

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
trusted observation's `receivedAt` are both at or after `eligibleAt`; the provider
trade timestamp is context, never an eligibility gate. Full-precision values are
compared exactly: equal prices keep the guess pending, and the first eligible
differing observation decides `correct` (`+1`) or `incorrect` (`−1`). Stale or
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

## Deployment

The demo runs as one [Render](https://render.com) free web service. The same
Fastify process serves the built React assets, the API, and the background
resolver; DynamoDB is provisioned separately in AWS. No disk, queue, or Lambda
is used.

### Render service

`render.yaml` is a minimal Render Blueprint for the service. Create a **Web
Service** from the repo (or **New → Blueprint** and point Render at the repo) with:

| Setting | Value |
|---|---|
| Runtime | Node.js `24` (`NODE_VERSION=24`); `package.json` pins `pnpm@12.9.1` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` (Render's Node runtime already provides pnpm; do **not** run `corepack enable`, which fails on the read-only build image) |
| Start command | `pnpm start` |
| Health check path | `/api/health` (works without database config) |
| Plan | Free |

`pnpm build` runs `pnpm typecheck`, builds `dist/client` with Vite, then compiles
the server to `dist/server`. `pnpm start` runs `dist/server/index.js`. Render sets
`PORT` for the process; the built server binds `0.0.0.0` when `NODE_ENV=production`,
so no extra host configuration is needed.

### Required environment variables

Set these on the Render service (Render dashboard → the service → **Environment**).
Secrets use `sync: false` in `render.yaml` and are entered in the dashboard, never
committed.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `PORT` | Platform-set | Render injects it; do not override |
| `AWS_REGION` | Yes | Region of the DynamoDB table, e.g. `us-east-1` |
| `DYNAMODB_TABLE` | Yes | Real AWS table name |
| `DYNAMODB_ENDPOINT` | **Omit** | Must be unset for AWS; loopback-only values are rejected |
| `AWS_ACCESS_KEY_ID` | Yes (secret) | Runtime IAM credentials, or omit for an attached role |
| `AWS_SECRET_ACCESS_KEY` | Yes (secret) | Paired with the key above |
| `AWS_SESSION_TOKEN` | Only for temporary creds | Needed only for assumed-role/session credentials |

The app uses the AWS SDK's standard credential/region chain, so an attached IAM
role works without static keys where the platform supports one. Do not set
`DYNAMODB_ENDPOINT` in AWS; it is accepted only for a loopback DynamoDB Local URL.

### Provisioning DynamoDB

Create the table on AWS separately (out of band; the app does not create it in
production):

- Table name: matches `DYNAMODB_TABLE`.
- Partition key: `playerId`, type String. No sort key. `PAY_PER_REQUEST`
  (on-demand) is sufficient at demo scale.
- Region: matches `AWS_REGION`.

`pnpm db:setup` creates the same table locally; it is not run against AWS. The
resolver's due-guess discovery uses `Scan`; at demo scale the table is small, so
no GSI or secondary index is provisioned.

### Least-privilege IAM policy

Grant the app's runtime identity only these actions on the specific table. Replace
`<REGION>`, `<ACCOUNT_ID>`, and `<DYNAMODB_TABLE>` with the real values; the table
ARN ends with the table name (no index ARN is needed).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/<DYNAMODB_TABLE>"
    }
  ]
}
```

- `GetItem` reads player state; `PutItem` creates a player; `UpdateItem` accepts a
  guess and atomically resolves it; `Scan` is the resolver's due-guess discovery.
- Local `pnpm db:setup` additionally needs `DescribeTable`/`CreateTable`; the
  isolated `pnpm test:integration` run additionally needs `DeleteTable`. Those are
  local/test-only and are intentionally not in the runtime policy. Neither is run
  against the production table.

### Troubleshooting and logs

- **Where logs live:** Render dashboard → the service → **Logs**. Fastify writes
  structured JSON; automatic request/error serializers omit URLs, headers, IPs,
  names, credentials, and raw errors. No external observability service is added.
- **Correlating a request or job:** each response has a server-issued request ID in
  the `reqId` log field; player requests also log fixed `event`/`category`/
  `operation` fields. Pricing and resolver work logs safe generated job IDs. Search
  the logs by that ID to follow one request or sweep.
- **Provider vs storage vs resolver vs session:**
  - Provider trouble: pricing warnings (elapsed/receipt age, retry delay);
    `pricing.status` becomes `stale`/`unavailable`, and guesses stay pending.
  - Storage trouble: error-level storage categories; player routes return 503
    `persistence_unavailable`.
  - Resolver trouble: degraded discovery/provider/resolution events with bounded
    counts; expected obsolete conflicts aggregate at info.
  - Session trouble: a missing/expired `btc_player` cookie gives 401 `unauthorized`;
    create a player again with `POST /api/players`.
- **Repeated failures/recovery:** failures are rate-limited to one warning per
  operation per minute per instance; a success logs one recovery, so a single
  recovery line confirms a retry worked. Routine validation/auth/conflict responses
  and successful operations are intentionally not logged.

### Deployment limitations

- **Render free sleep/wake:** the free instance sleeps when idle. On wake it must
  restart and catch up. Pending guesses are recovered from DynamoDB (not memory),
  so sleep only **delays** resolution until the service wakes; it does not lose
  score. This demo does not guarantee always-on background resolution.
- **Cookie loss loses the player:** identity is the `btc_player` HttpOnly session
  cookie (no Max-Age/Expires). Clearing cookies or switching browsers starts a new
  player; there is no password/login and no guaranteed identity after closing the
  browser.
- **Sampled pricing:** Coinbase `time` is the last trade timestamp, not a promise of
  freshness; pricing is polled and cached (see the T003 table above), so the
  displayed price is the last trusted observation, never an invented current price.
  Stale data is labelled.
- **Free-tier cost:** Render free instance, AWS on-demand DynamoDB at demo scale,
  and unauthenticated Coinbase public data. Arrange an AWS budget alert; no paid
  observability or extra service is added.

### Deployment status and open items

Verified so far: the public repository URL, the demo URL, static/asset serving, SPA fallback, API routing, and the `/api/health` check. Gameplay is not yet playable because AWS DynamoDB is not configured (`POST /api/players` returns `503 persistence_unavailable`).

Remaining open items:
- **Hosted smoke-test evidence** (onboarding, fresh price, submission/pending,
  result and score, same-session reload, restart-pending recovery,
  stale/provider-unavailable): `TBD — awaiting deploy`
- **Restart/wake + stale verification:** `TBD — awaiting deploy`
- **Diagnostics redaction review** (hosted logs checked for cookie headers,
  credentials/digests, secrets, names, raw provider payloads): `TBD — awaiting
  hosted log access`
- **T006 gap-matrix summary:** see [docs/testing.md](docs/testing.md); every matrix
  row has passing local evidence. Live provider health, AWS IAM, and hosted
  deployment rows remain part of this task.

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
