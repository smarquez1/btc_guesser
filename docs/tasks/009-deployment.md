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

Complete. One Render Node web service serves the built React client
and Fastify API on the same HTTPS origin, with DynamoDB in us-east-2.

- @fastify/static serves the production frontend from dist.
- Review fix: reject production startup when dist/index.html is missing instead
  of reporting a healthy API with no playable frontend.
- Start command accepts platform environment variables without requiring .env;
  local development commands still require .env.
- Render Node version is pinned to the version in .tool-versions.
- Production defaults bind to 0.0.0.0, enable secure cookies, and use Render's
  supplied RENDER_EXTERNAL_URL as the origin. Explicit settings take precedence;
  a custom domain requires APP_ORIGIN. Local development defaults are unchanged.
- AWS authentication uses a dedicated IAM user restricted to the application
  table on Render Hobby. Managed OIDC requires Render Pro or higher.
- User confirmed the local app works against the AWS table, including guess
  resolution and persisted scores. Table keys and expiresAt TTL were verified.
- Validation on 2026-10-08: lint, typecheck, existing unit tests, all eight
  DynamoDB Local integration tests, and production build pass. Integration
  checks override DYNAMODB_ENDPOINT to the local instance on port 8000 and use
  isolated temporary tables; the AWS application table is not used.
- Those checks precede the current review changes. The user confirmed the hosted
  flow works; latest local changes still need checks, commit, and deployment.
- User requested removing the IP-based player-creation limit to keep deployment
  simple. Removed the route's 429 branch, service IP hashing, and DynamoDB counter
  writes; adjusted existing unit/route/integration tests. No new tests added.
  Final cleanup validation passes; user requested committing the complete cleanup.

## Deployment code review on 2026-10-08

- First Render build failed at corepack enable: EROFS while replacing /usr/bin/pnpm.
  Corrected commands invoke corepack pnpm directly for install, build, and start,
  avoiding system shim changes while selecting package.json's pinned pnpm.
  User confirmed the subsequent hosted build and game flow work.

- Reviewed configuration precedence, production entrypoint, static/API routing,
  cookie settings, DynamoDB credential chain, and repository item operations.
- Resolved by scope change: shared proxy-IP creation limits are removed at the
  user's request. Proxy trust stays disabled; player creation no longer uses IPs.
- Render Hobby uses a dedicated IAM user with table-scoped GetItem, PutItem, and
  UpdateItem permissions. User confirmed credentials are saved and the hosted
  guess flow and reload persistence work at https://btc-guesser.onrender.com.
  A green process health check alone does not establish database access.
- Local production smoke check without .env or AWS requests: GET / returns the
  built HTML (200), GET /api/health returns 200, and GET /api/unknown returns a
  JSON 404. Missing-build startup guard added after this check.
- README, AGENTS.md, backend guidance, and tool guidance now describe the Render
  setup, production defaults, separate SSO/database regions, and local test overrides.
- No new test files, formatter runs, or commit made during this review.
- Documentation cleanup: README now focuses on local setup, Render settings,
  checks, and design constraints. Detailed API behavior remains in backend.md;
  AWS CLI access is documented in tools.md. AGENTS.md links deployment settings instead of
  duplicating them and consolidates the superseded direction-button guidance.

## Final cleanup validation

- Live URL: https://btc-guesser.onrender.com. User confirmed production guesses,
  resolution, score changes, and reload persistence against AWS DynamoDB.
- Removed player-creation throttling and its counter writes at user request.
  Updated concurrency coverage verifies sixteen creations succeed with distinct
  cookies across two app instances. Legacy counters expire by TTL.
- Initially replaced @fastify/static with native routes, then restored the
  library after reviewing the maintenance tradeoff with the user. The library
  handles file serving and content types; startup still rejects a missing build.
  Restored-plugin smoke verification passes for HTML, JS/CSS, and traversal
  rejection. Prior native-route checks below are historical. The amended commit's
  Lefthook checks enforce lint, typecheck, unit/integration tests, and build.
- Final lint, typecheck, existing unit tests, eight DynamoDB Local integration
  tests, and production build pass. The sandbox blocked the first database
  attempt; rerunning with approved access passed. No AWS test tables were used.
- Smoke verification passes for HTML, JS/CSS, cache headers, unknown API paths,
  encoded traversal rejection, and Render configuration defaults.
- All assignment tasks are closed. Render still needs to deploy the cleanup
  commit; hosted confirmation above used the prior deployment. Mobile and CI
  remain outside scope.
