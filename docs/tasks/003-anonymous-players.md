# Anonymous players

Depends on: 002.
Read docs/backend.md. Implement anonymous player creation and identity validation.

## Acceptance criteria
- New players start with a score of zero persisted in DynamoDB.
- Returning players can reuse a backend-validated identity.
- Invalid identities receive explicit, safe errors.
- Player creation has no rate limit (user-requested simplification on 2026-10-08).
- Client-provided scores and player state are never authoritative.

## Validation and limitations

The original rate-limit implementation and its validation below are historical.
On 2026-10-08 the user requested its removal. Creation now writes profiles
directly without IP hashing or counters. Relevant existing tests were updated;
unit and DynamoDB Local integration validation pass for the removal.

- Implemented `POST /api/players` and `GET /api/players/me`, focused route,
  service, repository, response schema, and shared player type. Startup wires the
  configured DynamoDB client and closes it during shutdown.
- New profiles persist a generated name, zero score, and epoch-second creation
  time. UUID v4 bearer identities use an HTTP-only SameSite Strict cookie;
  responses exclude the token and database keys. Returning identities receive
  the persisted profile; malformed, unknown, and missing identities return safe
  401 responses. Supplied state fields and foreign browser origins are rejected.
- Creation uses a conditional DynamoDB counter for ten attempts per connection
  IP per UTC hour; ephemeral counters carry epoch-second TTL. Hour-specific keys
  avoid relying on asynchronous TTL deletion. Player profiles have no expiry.
- Direct verification on 2026-10-07 used Fastify injection against actual DynamoDB
  Local on port 8001 in a unique temporary table, deleted afterward. Verified
  zero-score persistence, integer timestamps, profile reuse via GET/POST, omitted
  identity in responses, cookie security flags, invalid/missing identities,
  score-input rejection, foreign-origin rejection, and Retry-After on throttling.
  Fourteen concurrent creation requests produced exactly ten 201s and four 429s,
  including spoofed forwarded IPs. The application table was untouched.
- No formatter, lint, typecheck, or end-to-end checks were run, per task guidance.
  No new automated test files were added; coverage review remains task 007.
- Limitations: cookie loss has no recovery; anonymous users can create new
  identities within the limit. A failed write can consume an attempt. Connections
  through a proxy share its IP until trusted-proxy deployment configuration is
  supplied. DynamoDB Local does not automatically delete TTL records.

- Added requested automated coverage: five deterministic player-service tests and
  six Fastify route tests cover identity validation, zero-score creation, server
  timestamps, rejection before storage, returning profiles, cookie flags, safe
  errors, and throttling. Two real DynamoDB tests cover cross-instance persistence,
  authoritative score reads, duplicate-write protection, atomic creation limits
  across app instances, forwarded-IP spoof resistance, independent address limits,
  hourly boundaries, and expiry while old counter records remain present.
- Both suites passed on 2026-10-07: 33 unit/Fastify tests with
  `mise exec -- pnpm test`; five DynamoDB integration tests with
  `TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8001 mise exec -- pnpm test:integration`.
  Integration tables were unique and deleted afterward. No lint, typecheck,
  formatter, or end-to-end checks were run; changes remain uncommitted.

- Pre-commit validation: fixed missing 4xx response schemas exposed by TypeScript;
  `pnpm lint` and `pnpm typecheck` pass. Reran all 33 unit/route tests and five
  local DynamoDB integration tests successfully after the schema change.
