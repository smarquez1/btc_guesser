# Guess lifecycle

Depends on: 003, 004.
Read docs/backend.md. Implement submission and lazy/on-demand resolution.

## Acceptance criteria
- Backend validates direction and allows only one unresolved guess per player.
- Backend owns starting price, timestamps in epoch seconds, and the 60-second deadline.
- Only observations at or after the deadline can resolve a guess.
- Equal prices remain pending; correct guesses earn +1 and incorrect guesses lose 1.
- Persist result evidence and score changes atomically, preventing duplicate scoring
  and conflicting concurrent submissions.
- Shared rules determine consistent behavior across routes.

## Validation and limitations

Implementation approved; requested automated coverage passes. Acceptance criteria
are met; changes remain uncommitted.

- Added authenticated submission and lookup routes, response schema, shared guess
  type, focused service with a pure resolution rule, and DynamoDB repository.
- Submission rejects extra state fields and invalid directions, requires fresh
  pricing, and sets integer epoch-second start/deadline timestamps server-side.
  Conditional transactions enforce one pending guess and exactly-once scoring.
- Lazy lookup checks ownership and deadline eligibility separately from cache
  freshness. Equal prices stay pending. Resolved records preserve evidence and
  expire after 24 hours; pending guesses and player scores do not expire.
- Direct DynamoDB Local verification on 2026-10-07 used a unique temporary table,
  deleted afterward. Eight concurrent submissions created exactly one guess;
  early, equal-price, and pre-deadline observations remained pending. Eight
  concurrent resolutions returned resolved evidence with a single +1 score
  change and cleared pending ID. Another player's lookup returned no guess.
  Eligibility was exercised by moving only the temporary guess's deadline.
- Direct Fastify injection verified route registration, invalid/extra input,
  missing identity, foreign origin, successful submission, pending conflict,
  lookup ID validation, response privacy, and Cache-Control: no-store using
  controlled service responses. This was separate from real-storage verification.
- Initial implementation verification did not add automated test files or run
  formatter, lint, typecheck, or end-to-end checks. Requested coverage follows below.
- Limitations: resolution occurs on guess lookup, not profile/price reads or
  submission. Upstream outage can delay resolution. Resolved evidence is available
  for 24 hours; scores remain. Concurrent requests can fetch pricing independently.
- Review fix: submission and resolution now retry transaction-conflict
  cancellations up to three times with exponential backoff and jitter. Conditional
  failures keep their existing conflict/result-reread behavior; other failures
  and exhausted retries propagate. Requested retry-specific coverage passes.
- Added 22 unit/Fastify tests covering every direction/outcome, exact deadline
  eligibility, equal and future observations, preserved evidence, fresh-price
  submission, ownership/expiry, lazy reads, concurrent-result rereads, API input,
  identities/origins, conflicts, retry hints, response privacy, and safe errors.
  Repository coverage exercises both operations through conflict recovery,
  retry exhaustion, subsequent conditional failure, and nonretryable failures.
- Added a real DynamoDB integration test across two app instances. Eight
  concurrent submissions create one guess; eight resolutions score once. Covers
  early/ineligible/equal observations, ownership, positive and negative scoring,
  subsequent submission, expiry before TTL cleanup, no orphan after failed
  creation, and atomic rejection of an attempted resolved-result overwrite.
- Validation on 2026-10-07: all 73 unit/Fastify tests pass with
  `mise exec -- pnpm test`; all eight local DynamoDB integration tests pass with
  `TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8001 mise exec -- pnpm test:integration`.
  Temporary tables were deleted afterward; application data was untouched.
  `git diff --check` passes. No lint, typecheck, formatter, end-to-end checks, or
  commit were run during this coverage task.
- Pre-commit validation: corrected the missing-guess return type in a test
  fixture. Whole-project lint and typecheck pass; all 73 unit/API tests pass.
  Started Colima and DynamoDB Local on the default port 8000. The expanded
  Lefthook check passes Biome, typecheck, all 73 unit/API tests, all eight
  DynamoDB integration tests, and the production build. Lefthook now runs all
  these checks before every commit. No formatter or end-to-end checks were run.
