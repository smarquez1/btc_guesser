# Backend foundation

Read docs/backend.md. Set up Fastify startup, configuration validation,
explicit DynamoDB access, and the local table setup command.

## Acceptance criteria
- Backend starts with the documented local configuration.
- Invalid configuration fails with a useful message.
- DynamoDB keys and TTL configuration support the required access patterns.
- Document table keys and access patterns, including the atomic writes needed by
  the guess lifecycle. Use epoch seconds for TTL and all backend timestamps.
- Routes, services, repositories, and schemas have focused responsibilities.
- README and .env.example match working setup commands; no secrets are committed.

## Validation and limitations

- Implemented separate Fastify app construction/startup, a schema-backed
  `GET /api/health`, safe error responses, and SIGINT/SIGTERM shutdown.
- Added configuration validation, AWS SDK clients using the normal credential
  chain, Docker Compose for persistent local DynamoDB, and repeatable table setup.
- Documented direct player/guess/cache lookups and planned conditional transactions
  in `docs/backend.md`. Game repositories/services belong to tasks 003–005;
  no empty layers were added for this foundation.
- Direct verification on 2026-10-07: server returned health 200 and unknown-route
  404; invalid port, missing region, invalid origin, and invalid cookie boolean
  exited with useful errors. SIGTERM stopped the verification process.
- Created the local table and reran setup successfully. Inspected the actual
  schema: string `pk` (HASH), string `sk` (RANGE), ACTIVE table, and ENABLED
  `expiresAt` TTL. Setup without an endpoint correctly refused to run.
- Existing services occupied ports 3000/8000, so verification used 3001/8001
  with `.env.example` and overrides; README documents port changes. No existing
  services were changed. The project DynamoDB container remains on port 8001.
- DynamoDB Local does not delete TTL records automatically. AWS deployment and
  automatic cleanup verification remain deferred. Health checks process liveness,
  not database readiness; the backend does not yet serve the built frontend.
- Added requested automated coverage: 17 configuration unit tests and five
  Fastify injection integration tests pass with `mise exec -- pnpm test`.
- Three real DynamoDB integration tests pass with
  `TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8001 mise exec -- pnpm test:integration`.
  They verify creation/reruns, actual keys and TTL, document reads/writes, and
  rejection of incompatible keys or TTL. Unique test tables are deleted afterward;
  the application table is untouched. No end-to-end tests were added or run.
- Simplified configuration parsing: parse URLs once, reuse required-value handling
  for the host default, and remove a redundant numeric check. All 22 configuration
  and Fastify tests still pass.
- Testing guidance now permits requested unit/integration tests during development;
  task 007 reviews coverage before final end-to-end verification.
- Before committing, `pnpm lint`, `pnpm typecheck`, all 25 tests, and
  `git diff --check` passed. No formatter or end-to-end tests were run.
