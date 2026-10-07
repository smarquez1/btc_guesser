# BTC Guesser

The project folder is `btc_guesser`; the package name is `btc-guesser`.

The backend provides a health endpoint, anonymous player identities, Coinbase BTC/USD pricing, guess submission and resolution, and local DynamoDB setup. The React game UI is being implemented in task 006 and still requires browser verification. The UI guide is in [docs/ui.pen](docs/ui.pen); implementation tasks and status are tracked in [docs/tasks/index.md](docs/tasks/index.md).

The frontend uses React, TypeScript, Vite, and Tailwind CSS with semantic native
HTML. Keep markup and styling minimal; small amounts of plain CSS are fine.
The mockup guides layout and game states, without requiring exact visual matching.
Task 006 retains Tailwind and removes unused shadcn configuration and dependencies.
No UI component library is needed.

## Development tools

Tool versions are recorded in `.tool-versions` for mise. Node and pnpm match versions already installed locally.

```sh
mise install
mise exec -- pnpm install
cp .env.example .env
docker compose up -d
mise exec -- pnpm db:create
```

Docker Compose runs DynamoDB Local on `127.0.0.1:8000` with a persistent named
volume. Stop it with `docker compose down`; the data remains for the next start.
If port 8000 is occupied, run `DYNAMODB_LOCAL_PORT=8001 docker compose up -d`
and set `DYNAMODB_ENDPOINT=http://127.0.0.1:8001` in `.env`.
The local credentials in `.env.example` are placeholders, not AWS credentials.

`.env` is required for backend startup, database setup, and integration tests.
These commands fail immediately if it is missing. Keep the file local; Git ignores it.

`db:create` uses the endpoint configured in `.env`, creates the table if missing,
checks its string `pk`/`sk` keys, and enables `expiresAt` TTL. It is safe to rerun
and refuses to run without an explicit endpoint. See [the storage model](docs/backend.md#storage-model).

Start the backend and frontend in separate terminals:

```sh
mise exec -- pnpm dev:server
mise exec -- pnpm dev
```

Open the frontend at `http://127.0.0.1:5173`, matching `APP_ORIGIN` in
`.env.example`. If an existing `.env` uses `http://localhost:5173`, update it to
the same origin and restart the backend. Origin checks compare the exact host.

Check `http://127.0.0.1:3000/api/health` for `{ "status": "ok" }`. This is a
process health check, not a DynamoDB readiness check. Vite proxies `/api` to
port 3000; update `vite.config.ts` if you change the backend port.

The backend validates configuration before listening. `PORT` defaults to 3000,
`HOST` to `127.0.0.1`, and `COOKIE_SECURE` to false. `AWS_REGION`,
`DYNAMODB_TABLE`, and `APP_ORIGIN` are required. `APP_ORIGIN` must be a browser
origin without a path. Set `COOKIE_SECURE=true` when serving over HTTPS.

Build the client and run the backend:

```sh
mise exec -- pnpm build
mise exec -- pnpm start
```

The backend currently serves only API routes; serving the built client and
production deployment belong to task 009. For AWS, omit `DYNAMODB_ENDPOINT`
and the local credential placeholders, and use the normal AWS credential chain.
Do not use `db:create` to provision deployed infrastructure.

## Anonymous players

`POST /api/players` takes no fields (omit the body or send `{}`). It creates a
player with a generated name and persisted score of zero, returning 201. An
existing valid cookie returns that same player with 200. `GET /api/players/me`
returns the persisted profile. Responses contain `name`, `score`, `createdAt`
(epoch seconds), and `pendingGuessId` when present; identity tokens are omitted.

The browser retains the opaque identity in the `btc_player` cookie, scoped to
`/api`, HTTP-only, SameSite Strict, and valid for one year. Frontend requests use
the same-origin `/api` proxy; JavaScript does not need to read the token. Invalid,
unknown, or missing identities return 401 on profile reads. Creation with an
invalid cookie returns 401 and clears it; a subsequent creation can start fresh.
Losing the cookie loses access to that player's score; recovery is out of scope.

Creation rejects supplied player fields with 400 and foreign browser origins
with 403. New identities are limited to ten creation attempts per source IP per
UTC hour using an atomic DynamoDB counter. Exceeding the limit returns 429 with
`Retry-After`; returning players do not consume attempts. Failed database writes
return a safe 500 and may consume an attempt. Rate-limit records use TTL; player
profiles retain their score without TTL.

Fastify currently uses the connection IP and does not trust forwarded headers.
The Vite proxy can therefore share one limit among local browsers. Deployment
must configure a trusted proxy deliberately if individual client limits are
needed behind a load balancer. Never blindly trust client-supplied forwarded IPs.

## BTC/USD pricing

`GET /api/price` needs no player identity and returns:

```json
{ "symbol": "BTC-USD", "price": 83441.34, "observedAt": 1791393486, "stale": false }
```

The backend calls the public [Coinbase Exchange ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)
with a five-second timeout and validates the response. `observedAt` is the last
trade's timestamp in integer epoch seconds, preserved across all cache reads.
No Coinbase API key is required.

DynamoDB stores the shared latest observation, with a five-second freshness
window measured from the successful fetch and one-hour retention from `observedAt`. Fresh reads avoid
Coinbase. Missing or stale cache entries trigger a refresh. Conditional writes
order observations by Coinbase trade ID, including trades within the same second.
Fetching the same trade again can extend freshness without changing `observedAt`;
cache reads alone never extend freshness. Trade IDs stay internal to the cache. HTTP responses use `Cache-Control: no-store`.

If Coinbase fails or returns an observation older than retention, the API returns
an available cached observation with its original timestamp and freshness flag.
A stale fallback has `stale: true`; it expires after one hour even if DynamoDB
has not deleted its TTL record. Without an available observation the response is
503 with `{ "error": "BTC price unavailable" }` and `Retry-After: 5`. DynamoDB
failures return safe 500 responses. Cache freshness does not establish whether
an observation is eligible to resolve a guess; resolution checks its timestamp.

## Guesses

`POST /api/guesses` accepts only `{ "direction": "up" }` or
`{ "direction": "down" }` with the player's cookie. It returns 201 with the
guess ID, direction, pending status, starting price and observation time,
`startedAt`, and `deadline` (60 seconds after submission). All times are integer
epoch seconds set by the backend. Submission requires a fresh cached or fetched
price; unavailable or stale pricing returns 503 with `Retry-After: 5`.
Invalid fields return 400, invalid identity 401, foreign origins 403, and an
existing pending guess 409. Creation atomically stores the guess and sets the
player's pending ID, so concurrent submissions cannot both succeed.

`GET /api/guesses/:id` returns the authenticated player's guess and lazily
resolves it when an observation at or after its deadline differs from the
starting price. Early observations and equal prices leave it pending. Source
timestamps establish eligibility independently of freshness. An upstream outage
without an available observation leaves the guess pending; storage failures
return safe 500 responses. Unknown, expired, or another player's guesses return
404. Responses omit identity and storage fields and disable HTTP caching.

A resolved response also includes `finalPrice`, `finalObservedAt`, `resolvedAt`,
`correct`, and `scoreDelta` (+1 or -1). The result, score update, and removal of
the pending ID commit together exactly once. Read `/api/players/me` afterward
for the current score. Poll the pending guess before submitting another guess;
submission itself does not resolve an existing one. Pending guesses never
expire; resolved evidence expires after 24 hours, while scores remain persisted.

## Project MCP servers

The configuration is supplied in `codex-mcp.toml`. This environment prevents creating `.codex/config.toml`, so enable it locally with:

```sh
mkdir -p .codex
cp codex-mcp.toml .codex/config.toml
```

If you already have a project configuration, merge the MCP entries into it instead of replacing it. Restart Codex with this project trusted, then check `/mcp`.

- The UI uses native HTML and Tailwind CSS; no shadcn MCP is needed.
- [AWS API MCP](https://awslabs.github.io/mcp/servers/aws-api-mcp-server) inspects DynamoDB and deployment resources. `READ_OPERATIONS_ONLY=true` restricts AWS API calls to read operations; IAM permissions still apply.

AWS MCP expects the `awslabs.aws-api-mcp-server` executable to be installed separately and available on PATH. It is not managed by this project. Install it in an external Python environment with Python 3.10+ using `python -m pip install awslabs.aws-api-mcp-server`.

AWS MCP uses the local AWS credential chain. Configure credentials outside the repository and launch Codex with your intended profile and region:

```sh
aws configure sso --profile btc-guess
aws sso login --profile btc-guess
AWS_PROFILE=btc-guess AWS_REGION=us-east-1 codex
```

Replace the example profile and region with your own. Never store credentials in project configuration. For the app or IDE, ensure its environment has the intended AWS profile and region before restarting it. The application's `.env` is not automatically loaded by MCP.

## Checks before commits

Lefthook runs Biome on staged source files, TypeScript (`tsc --noEmit`) on the whole project, all unit and DynamoDB integration tests, and the production build before each commit, without rewriting files. DynamoDB Local must be running. Integration tests load `DYNAMODB_ENDPOINT` from `.env`, copied from `.env.example`; update it there when using a different local port. `pnpm install` installs the hook through the project's `prepare` script. To install it manually:

```sh
pnpm exec lefthook install
```

Before committing, check the entire project with:

```sh
pnpm lint
pnpm typecheck
```

The workflow is implementation, user approval, requested tests, then commit.
Do not add tests before the user requests them. Formatting is not part of the commit hook. Add and run unit tests when the
developer asks, before committing related work. The hook runs both test suites.

## Tests

```sh
mise exec -- pnpm test
```

This runs deterministic configuration, player, Coinbase-client, and pricing unit
tests plus guess lifecycle/retry coverage and Fastify route integration tests using injection, without a listening
server or external services. Pricing tests cover source validation, fetch-based
freshness, unchanged tickers, expiry, stale fallback, and safe error responses. Player coverage includes identity validation, initial scores, cookie
security, input/origin rejection, throttling, and safe database error responses.

Frontend coverage uses Node's test runner, jsdom, React `act`, controlled fetch
responses, and fake clocks. It covers API errors and identity recovery, pending
guess recovery across tabs, duplicate submissions, stale-response rejection,
uncertain submission recovery, Strict Mode cancellation, polling cleanup and
retries, countdowns, and clearing result price colors on newer observations.
These tests use no real network calls, database, browser, or timed waits.

For real DynamoDB integration tests, start the local container and set
`DYNAMODB_ENDPOINT` in `.env` to its loopback endpoint (port 8000 in
`.env.example`):

```sh
mise exec -- pnpm test:integration
```

Use port 8001 if configured above. Tests share the local DynamoDB instance with
the app but create uniquely named temporary tables and delete them afterward;
they reject nonlocal endpoints and do not use the application table or AWS
credentials. They verify table setup, reruns, incompatible keys/TTL, document reads/writes,
player persistence across app instances, conditional profile creation, concurrent
creation limits, hourly rollover while old TTL records still exist, concurrent
price writes ordered by trade ID, unchanged-trade freshness updates, and explicit
price expiry before TTL cleanup. Guess coverage verifies concurrent submission
and resolution across app instances, exactly-once positive/negative scoring,
observation eligibility, ownership, transaction rollback, and resolved evidence
expiry before TTL cleanup.
For the focused Playwright happy-path test, keep DynamoDB Local running and
configure its loopback `DYNAMODB_ENDPOINT` in `.env`, then run:

```sh
mise exec -- pnpm exec playwright install chromium
mise exec -- pnpm test:e2e
```

The test starts its own Vite frontend on port 5174 and backend on port 3001;
leave those ports free. It creates and deletes a unique temporary DynamoDB table
and uses local placeholder credentials, leaving application data untouched.
Chromium runs at 1440 × 900. The test creates an anonymous player, submits a
higher guess, advances test clocks through the 60-second deadline, verifies a correct result and
score +1, then reloads to confirm identity and score persistence. Only the Coinbase
price source is controlled to produce increasing prices; browser requests,
backend rules, caching, transactions, and DynamoDB persistence are real.
Node's built-in mock clock controls backend dates, and Playwright's clock controls
browser dates. Network and polling timers remain real. The test confirms pending
at 59 seconds, then advances to 65 seconds to allow any pre-deadline five-second
price cache to expire before resolution. Game rules and stored deadlines are unchanged.
It runs in seconds. Failure traces are saved under ignored `test-results/`.
Broader error-state and desktop verification remain tracked in task 008; no CI
or broad browser suite is configured.
