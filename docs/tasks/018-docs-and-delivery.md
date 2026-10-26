# Migration docs and delivery

Depends on: 017.

## Scope and acceptance criteria

- Update README, repository guidance, backend/UI/tool guidance, and task history
  to describe Fastify-rendered HTML and HTMX.
- Keep one Render Node service and AWS DynamoDB; no hosting/storage migration.
- Document accurate development origin, asset build, start, and deployment commands.
- Record validation results and limitations, including ambiguous submission
  outcomes and 24-hour result evidence retention.
- Do not deploy unless separately requested.
- Do not create commits as part of this task; leave that to the user.

## Validation results

- Updated README, repository instructions, and backend/UI/tool guidance for the
  Fastify-rendered HTMX app, local origins, manifest-backed assets, and retained
  Render/DynamoDB architecture.
- Documented that `/api/health` is the only JSON HTTP endpoint and that anonymous
  identity recovery depends on the `/api`-scoped cookie.
- No deployment or commit performed. Task complete after final validation.

## Validation plan

- Review all documented commands against package scripts and production entrypoint.
- Before a requested commit, use the repository's required staged lint,
  typecheck, unit/integration, and production-build checks.
