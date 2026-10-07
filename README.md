# BTC guess

The project is in setup. The client currently renders an empty React root. The approved UI mockup is in [docs/ui.pen](docs/ui.pen); implementation tasks and status are tracked in [docs/tasks/index.md](docs/tasks/index.md).

## Development tools

Tool versions are recorded in `.tool-versions` for mise. Node and pnpm match versions already installed locally.

```sh
mise install
mise exec -- pnpm install
cp .env.example .env
mise exec -- pnpm db:create
```

`db:create` requires DynamoDB at the endpoint configured in `.env`. Start the backend and frontend in separate terminals:

```sh
mise exec -- pnpm dev:server
mise exec -- pnpm dev
```

Build and run the production app:

```sh
mise exec -- pnpm build
mise exec -- pnpm start
```

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

Automated tests remain deferred. Formatting is not part of the commit hook.
