# Tool guidance

Use tools deliberately.

Do not call MCP servers merely because they are available.

## Context7

Use Context7 when current library documentation matters.

Good uses include:

- Fastify
- AWS SDK
- DynamoDB
- React
- Vite
- Tailwind
- third-party package APIs

Prefer current documentation over model memory when behavior may have changed.

Do not use Context7 for code that is already clear from the repository.

## shadcn MCP

Use shadcn MCP for:

- discovering relevant components
- checking component usage
- adding required shadcn primitives

Do not browse or install large numbers of components unnecessarily.

Use the smallest set required for the UI.

For pen.dev and Playwright workflows, read [ui.md](ui.md).

## AWS

Use the official AWS tooling for deployed AWS resources.

Good uses include:

- inspecting DynamoDB tables
- checking TTL configuration
- inspecting deployed resources
- checking logs
- diagnosing runtime/deployment failures
- verifying IAM/resource configuration

Prefer read operations first.

Do not use AWS tooling as a replacement for reproducible repository configuration.

Do not create AWS infrastructure merely because the tooling makes it easy.

Changes required to deploy or run the project should remain understandable from source control.

## DynamoDB MCP

Do not add a separate DynamoDB MCP server by default.

Use AWS tooling plus current DynamoDB documentation for routine work.

Only consider a dedicated DynamoDB MCP if the data model becomes complex enough that specialized access-pattern modeling provides meaningful value.
