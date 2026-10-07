# BTC pricing

Depends on: 002.
Read docs/backend.md. Fetch Coinbase BTC/USD observations and cache in DynamoDB.

## Acceptance criteria
- API exposes the latest available price and its observation timestamp in epoch seconds.
- Cache reads preserve observedAt; freshness and resolution eligibility are separate.
- Cache records have an explicit expiry and appropriate TTL.
- Check cache freshness explicitly; asynchronous TTL cleanup does not determine freshness.
- Missing/stale observations and Coinbase failures have explicit behavior.
- Coinbase I/O stays separate from pricing rules.

## Validation and limitations

Implementation approved; automated coverage and pre-commit checks pass.

- Added a public `GET /api/price` route, response schema, pricing service,
  Coinbase HTTP client, DynamoDB repository, and shared price types.
- Source: Coinbase Exchange BTC-USD ticker. Validated positive prices and source
  timestamps are normalized to integer epoch seconds. HTTP timeout is five seconds.
- Shared cache freshness lasts five seconds from a successful fetch, independently
  of the source `observedAt`. Retention lasts one hour from source time. Cache reads
  do not refresh timestamps; explicit expiry checks work before TTL cleanup.
  Conditional writes order observations by validated Coinbase trade ID, including
  trades within the same second. Refetching the same trade can advance freshness
  without changing observation time or retention; older trades cannot replace it.
- Coinbase failures return available cached data with an explicit `stale` flag;
  missing/expired observations return safe 503 with Retry-After. Database failures
  propagate to the existing safe 500 handler. HTTP caching is disabled.
- Direct verification on 2026-10-07 used real Coinbase plus DynamoDB Local on
  port 8001 in a temporary table, deleted afterward. Live and cached requests
  returned 200 with identical `observedAt`; inspected separate freshness and TTL
  fields. An older write retained the stored winner. A simulated upstream outage
  returned marked stale data, then 503 once the record expired while still present.
  The application table was untouched.
- Followed implementation -> user approval -> tests -> commit. No formatter or
  end-to-end checks were run.
- Limitations: simultaneous misses can call Coinbase independently; no distributed
  refresh lock or outage backoff. Automatic TTL deletion requires AWS and is not
  simulated locally.

- Code review fixes separate successful-fetch freshness from trade time and use
  trade IDs to preserve same-second ordering. Direct verification of these changes
  passed on 2026-10-07: a newer same-second trade replaced the old price, a
  delayed older trade with later freshness was rejected, and an unchanged ticker
  refreshed freshness while preserving observation time and retention. Two
  consecutive service reads made one upstream call. Live/cache and outage/expiry
  checks still behaved correctly. The temporary DynamoDB table was deleted.
  Automated coverage was added after implementation approval.

- Automated validation on 2026-10-07: all 51 unit/Fastify tests pass with
  `mise exec -- pnpm test`, including 18 pricing tests. Coverage includes Coinbase
  payload/HTTP/JSON/network errors, preserved source time, initial/missing cache,
  exact freshness and expiry boundaries, unchanged-ticker refreshes, slow-request
  expiry, concurrent-refresh fallback, database failures, and API error schemas.
- All seven real DynamoDB integration tests pass with
  `TEST_DYNAMODB_ENDPOINT=http://127.0.0.1:8001 mise exec -- pnpm test:integration`.
  Two pricing tests verify concurrent same-second trade ordering, rejection of
  older trades even with later freshness, equal-trade refresh ordering, legacy
  cache upgrade, shared-cache reads, and expiry while TTL records remain present.
  Unique temporary tables were deleted; no application data was used.
- `mise exec -- pnpm lint`, `mise exec -- pnpm typecheck`, and
  `git diff --check` pass before committing.
