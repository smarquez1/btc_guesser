# Server-view and HTML-route coverage

Depends on: 015.

## Scope and acceptance criteria

- Replace React-only unit coverage with focused HTML route, game-view, and
  presentation coverage as part of the migration.
- Preserve behavior coverage for identity reuse, state recovery, result continuity,
  price selection/color, safe errors, and validation.
- Retain game service, repository, HTML route, and local DynamoDB integration
  coverage. Remove obsolete JSON endpoint coverage once equivalent HTML and
  persistence assertions exist.
- Remove implementation-specific React test mechanics after replacement
  evidence exists.

## Validation plan

- Run unit tests first, then integration tests against DynamoDB Local.
- Never point integration tests at AWS.

## Validation results

- Added HTML route coverage for session identity reuse/replacement, escaped
  rendering, origin protection, storage failures, pending-ID precedence, resolved
  score/result price/color, stale price availability, form validation, duplicate
  pending guesses, and unavailable pricing.
- Migrated DynamoDB integration coverage to the HTML session/form/fragment routes
  and repository-backed state assertions. Service/repository tests remain.
- Removed obsolete React UI/client tests and JSON route tests with the old routes.
- `mise exec -- pnpm test`: 67/67 passed.
- `mise exec -- pnpm test:integration`: 9/9 passed against local DynamoDB.
- Task complete; no commit made.
