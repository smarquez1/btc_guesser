# Deployment

Depends on: 008.
Prepare and deploy the working application. Read docs/tools.md before MCP usage
or AWS inspection. Choose a small deployment appropriate to the assignment.

## Acceptance criteria
- Production build and runtime configuration work with DynamoDB and Coinbase.
- Secrets stay outside the repository; document placeholders and required settings.
- Configure appropriate IAM permissions, TTL, browser origin, and secure identity.
- Verify the deployed critical flow and record the application URL.
- README contains accurate setup, build, run, and deployment commands.

## Validation and limitations

In progress. Target: one Render Node web service serving the built React client
and Fastify API on the same HTTPS origin, with DynamoDB in us-east-2.

- Production startup serves dist through the existing @fastify/static dependency.
- Start command accepts platform environment variables without requiring .env;
  local development commands still require .env.
- Render Node version is pinned to the version in .tool-versions.
- Production defaults bind to 0.0.0.0, enable secure cookies, and use Render's
  supplied RENDER_EXTERNAL_URL as the origin. Explicit settings take precedence;
  a custom domain requires APP_ORIGIN. Local development defaults are unchanged.
- AWS authentication choice is pending: managed OIDC requires Render Pro or
  higher; Hobby can use a dedicated IAM user limited to the application table.
- User confirmed the local app works against the AWS table, including guess
  resolution and persisted scores. Table keys and expiresAt TTL were verified.
- Validation on 2026-10-08: lint, typecheck, existing unit tests, all eight
  DynamoDB Local integration tests, and production build pass. Integration
  checks override DYNAMODB_ENDPOINT to the local instance on port 8000 and use
  isolated temporary tables; the AWS application table is not used.
- No new tests or formatter runs. Deployment, IAM permissions, and deployed
  flow verification remain pending.
- Proxy trust remains disabled: behind Render, creation limits may be shared
  among visitors using the same proxy address. Configure trusted proxy handling
  only after verifying Render's forwarding contract.
