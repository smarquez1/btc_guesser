# HTML guess submission

Depends on: 012.

## Scope and acceptance criteria

- Add an HTML submission endpoint under `/api/ui` that accepts only `up` or
  `down` from URL-encoded form data.
- Reuse existing identity/origin checks and guess services.
- Return a pending game fragment for successful submissions and reconcile
  conflicts to authoritative pending state.
- Keep prices, score, timestamps, deadlines, and resolution server-owned.
- Preserve all existing JSON endpoints and their tests until the HTML interface
  has replacement coverage and is approved for removal.

## Validation plan

- After implementation approval and an explicit test request, cover valid and
  invalid forms, origin rejection, unauthenticated requests, price unavailability,
  and pending-guess conflicts.
- Retain service/repository concurrency coverage.

## Implementation progress

- Added an HTML form endpoint under `/api/ui/guesses` accepting only the
  URL-encoded direction field and optional validated lookup ID in the query.
- Reuses the existing origin check and guess service; returns authoritative
  current state after creation, conflict, or unavailable pricing.
- Build/typecheck passes; focused route coverage runs with task 012's HTML route
  suite.
- `mise exec -- pnpm test`: all 99 unit/API tests pass, including form validation,
  successful submission, conflict reconciliation, and unavailable-price cases.
  Task complete.
