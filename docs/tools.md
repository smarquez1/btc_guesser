# Tool guidance

Use tools deliberately.

Do not call MCP servers merely because they are available.

## AWS CLI access

Authenticate with the intended local SSO profile:

```sh
aws configure sso --profile btc-guesser
aws sso login --profile btc-guesser
AWS_PROFILE=btc-guesser AWS_REGION=us-east-2 aws dynamodb list-tables
```

Use sa-east-1 for the SSO region.
Repeat SSO login if the token expires. To run the backend locally against AWS,
remove the local endpoint and placeholder credentials from .env, set the AWS
table/region, and run AWS_PROFILE=btc-guesser mise exec -- pnpm dev:server.

## Context7

Use Context7 when current library documentation matters.

Good uses include:

- Fastify
- AWS SDK
- DynamoDB
- React
- Vite
- third-party package APIs

Prefer current documentation over model memory when behavior may have changed.

Do not use Context7 for code that is already clear from the repository.

## UI tools

Use semantic native HTML and minimal Tailwind styling. Retain the existing Tailwind Vite plugin and CSS import. Do not use shadcn MCP or install a UI component library. Remove unused shadcn configuration during task 006.

Inspect the retained mockup with pen.dev as a loose design guide; do not spend time reproducing exact visual details. Playwright installation is authorized for direct browser verification when needed. Keep verification focused on the desktop game flow.

For pen.dev and Playwright workflows, read [ui.md](ui.md).

## AWS

The application host is Render; AWS hosts DynamoDB. Use the Render dashboard
for host settings and secrets, and AWS tooling for table and IAM inspection.
The local SSO profile is btc-guesser, Identity Center region sa-east-1, and
DynamoDB region us-east-2. Never copy SSO tokens or local .env into Render.

Use the AWS CLI for deployed AWS resources.

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
