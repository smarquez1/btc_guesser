# BTC guess

The backend foundation provides a health endpoint and local DynamoDB setup. The client currently renders an empty React root. The approved UI mockup is in [docs/ui.pen](docs/ui.pen); implementation tasks and status are tracked in [docs/tasks/index.md](docs/tasks/index.md).

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

`db:create` uses the endpoint configured in `.env`, creates the table if missing,
checks its string `pk`/`sk` keys, and enables `expiresAt` TTL. It is safe to rerun
and refuses to run without an explicit endpoint. See [the storage model](docs/backend.md#storage-model).

Start the backend and frontend in separate terminals:

```sh
mise exec -- pnpm dev:server
mise exec -- pnpm dev
```

Check `http://127.0.0.1:3000/api/health` for `{ "status": "ok" }`. This is a
process health check, not a DynamoDB readiness check. Vite proxies `/api` to
port 3000; update `vite.config.ts` if you change the backend port.

The backend validates configuration before listening. `PORT` defaults to 3000,
`HOST` to `127.0.0.1`, and `COOKIE_SECURE` to false. `AWS_REGION`,
`DYNAMODB_TABLE`, and `APP_ORIGIN` are required. `APP_ORIGIN` must be a browser
origin without a path. Identity settings are reserved for task 003.

Build the client and run the backend:

```sh
mise exec -- pnpm build
mise exec -- pnpm start
```

The backend currently serves only API routes; serving the built client and
production deployment belong to task 009. For AWS, omit `DYNAMODB_ENDPOINT`
and the local credential placeholders, and use the normal AWS credential chain.
Do not use `db:create` to provision deployed infrastructure.

## Project MCP servers

The configuration is supplied in `codex-mcp.toml`. This environment prevents creating `.codex/config.toml`, so enable it locally with:

```sh
mkdir -p .codex
cp codex-mcp.toml .codex/config.toml
```

If you already have a project configuration, merge the MCP entries into it instead of replacing it. Restart Codex with this project trusted, then check `/mcp`.

- [shadcn MCP](https://ui.shadcn.com/docs/mcp) provides components using the existing `components.json` and runs through pnpm.
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

Lefthook runs Biome on staged source files and TypeScript (`tsc --noEmit`) on the whole project before each commit, without rewriting files or running tests. `pnpm install` installs the hook through the project's `prepare` script. To install it manually:

```sh
pnpm exec lefthook install
```

Before committing, check the entire project with:

```sh
pnpm lint
pnpm typecheck
```

Formatting is not part of the commit hook. Add and run unit tests when the
developer asks, before committing related work. The hook does not run tests.

## Tests

```sh
mise exec -- pnpm test
```

This runs deterministic configuration unit tests and Fastify integration tests
using injection, without a listening server or external services.

For real DynamoDB integration tests, start the local container and explicitly
choose its loopback endpoint:

```sh
TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8000 mise exec -- pnpm test:integration
```

Use port 8001 if configured above. These tests create uniquely named temporary
tables and delete them afterward; they do not use the application table or AWS
credentials. They verify table setup, reruns, incompatible keys/TTL, and document
reads/writes. End-to-end tests remain deferred to task 008.
