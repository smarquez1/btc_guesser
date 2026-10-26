# HTML session and game-state loading

Depends on: 011.

## Scope and acceptance criteria

- Add a session endpoint and a game-state HTML endpoint under `/api/ui`.
- Reuse the existing `btc_player` cookie and its `/api` path, preserving current
  player identities and scores.
- Assemble a presentation view from existing player, price, and guess services;
  do not call HTTP routes internally or duplicate game rules.
- Prefer the profile's current pending guess over a remembered result ID.
- Treat remembered IDs as lookup hints only; preserve ownership checks and clear
  context on identity change.
- Re-read the profile after a resolution so returned score/pending state is fresh.
- Render escaped fragments for loading, ready, pending, resolved, and unavailable
  states. Personalized responses must be `no-store`.
- Add no storage schema or transaction changes.

## Validation plan

- After implementation approval and an explicit test request, cover identity
  reuse, invalid/missing identity recovery, pending precedence, result recovery,
  and error propagation in focused tests.
- Preserve backend service and DynamoDB tests.

## Implementation progress

- Added a server-side game-view assembler over the existing player, price, and
  guess services. It preserves pending-ID precedence, remembers owned resolved
  guesses, rereads the profile after resolution, and applies the existing result
  price precedence/color rule.
- Added same-origin HTML session and state endpoints under `/api/ui`; the
  existing `/api`-scoped HTTP-only cookie is unchanged.
- Added escaped EJS game, loading, and error fragments. The personalized page is
  non-cacheable, and missing/invalid cookies do not expose player identifiers.
- Build/typecheck passes; focused route and behavior coverage is scheduled in
  task 016.
- `mise exec -- pnpm test`: all 99 unit/API tests pass, including the new HTML
  session, identity recovery, pending precedence, result score/price, and stale
  price cases. Task complete.
