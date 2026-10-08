# BTC Guesser

Guess whether BTC/USD will rise or fall after 60 seconds. Correct guesses earn
one point; incorrect guesses lose one. Equal prices stay pending. Player identity
and scores persist across reloads using an HTTP-only cookie and DynamoDB.

**[Play the game](https://btc-guesser.onrender.com)** · Desktop only

React, TypeScript, Vite, and Tailwind frontend; Fastify backend with DynamoDB and
Coinbase's public price API. One Render web service serves the frontend and API.

## Run locally

Requires [mise](https://mise.jdx.dev/) and Docker. Versions are pinned in `.tool-versions`.

```sh
mise install
mise exec -- pnpm install
cp .env.example .env
docker compose up -d
mise exec -- pnpm db:create
```

Keep `.env` local. Its AWS credentials are placeholders for DynamoDB Local.
`db:create` creates the local table and enables TTL; it is safe to rerun.

Start the frontend and backend together:

```sh
mise exec -- pnpm dev
```

Keep DynamoDB Local running. To run either process separately, use
`pnpm dev:client` or `pnpm dev:server`. Stop the combined command with Ctrl+C.

Open **http://127.0.0.1:5173**, matching `APP_ORIGIN` in `.env`. Vite proxies `/api`
to the backend on port 3000. `localhost` and `127.0.0.1` are different origins.

DynamoDB Local runs on port 8000. If occupied, start it with
`DYNAMODB_LOCAL_PORT=8001 docker compose up -d` and update `DYNAMODB_ENDPOINT` in
`.env`. `docker compose down` stops it while preserving data.

## Deploy on Render

Create a **Node Web Service** connected to this repository's `main` branch.

| Setting | Value |
| --- | --- |
| Build command | `corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build` |
| Start command | `corepack pnpm start` |
| Health check | `/api/health` |
| Root directory, pre-deploy command, build filters | Leave blank |

Set these environment variables:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `AWS_REGION` | `us-east-2` (DynamoDB's region) |
| `DYNAMODB_TABLE` | `btc-guesser` |
| `AWS_ACCESS_KEY_ID` | Dedicated IAM user's access key |
| `AWS_SECRET_ACCESS_KEY` | Dedicated IAM user's secret key |

Render Hobby uses an IAM user restricted to `GetItem`, `PutItem`, and `UpdateItem`
on the application table. Keep keys in Render only. Do not upload `.env` or set
`AWS_PROFILE` or `DYNAMODB_ENDPOINT` there.

The AWS table requires string keys `pk` (partition) and `sk` (sort), and TTL on
`expiresAt`. No indexes are needed. Provision it separately; `db:create` is local only.

Production serves `dist` and rejects a missing build. It defaults to host
`0.0.0.0`, secure cookies, and Render's supplied URL as the allowed origin.
Render supplies `PORT`; `.node-version` pins Node. Set `APP_ORIGIN` for a custom
domain. Explicit `HOST`, `COOKIE_SECURE`, and `APP_ORIGIN` override defaults.

After deploying, check `/api/price`, submit a guess, wait for resolution, and
reload to confirm the score persists. `/api/health` checks the process only.

## Checks

```sh
mise exec -- pnpm test
mise exec -- pnpm test:integration
mise exec -- pnpm build
```

Integration tests require DynamoDB Local and `.env`. They use isolated temporary
tables and reject nonlocal endpoints. If `.env` points at AWS, override the endpoint
with `DYNAMODB_ENDPOINT=http://127.0.0.1:8000` for integration tests and commits.

For desktop browser tests, keep DynamoDB Local running and ports 3001 and 5174 free:

```sh
mise exec -- pnpm exec playwright install chromium
mise exec -- pnpm test:e2e
```

Browser tests cover correct/incorrect guesses, pending recovery, equal prices,
errors, and persistence with real backend/storage interactions and controlled
prices and clocks. Traces and screenshots go under ignored `test-results/`.

Before committing, run `mise exec -- pnpm lint` and `mise exec -- pnpm typecheck`.
Lefthook also runs staged lint, typecheck, unit/integration tests, and the build.
It does not format files.

## Design and limitations

The backend owns prices, timestamps, validation, and scoring. Conditional DynamoDB
transactions enforce one pending guess and apply each score change exactly once.
Results resolve when polled; no worker or queue is needed. Coinbase needs no API key.

Anonymous identities have no recovery after cookie loss. Player creation has no
rate limit. Scores persist; resolved guesses expire after 24 hours. Mobile/tablet
support and CI are outside the assignment's scope.

- [Backend and API details](docs/backend.md)
- [UI guide](docs/ui.md) and [mockup](docs/ui.pen)
- [Developer tools and AWS access](docs/tools.md)
- [Task status and validation](docs/tasks/index.md)
