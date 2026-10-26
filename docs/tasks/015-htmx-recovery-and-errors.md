# HTMX recovery and error behavior

Depends on: 014.

## Scope and acceptance criteria

- Coordinate polls and submissions so stale poll responses cannot replace a newer
  pending/result screen, duplicate submissions are dropped, and background polls
  do not queue behind writes.
- On uncertain submission, disable further guesses and reconcile with GETs; never
  automatically replay a potentially committed POST.
- Preserve last useful game/price state during outages and recover automatically.
- Preserve a remembered guess ID across swaps and tabs; treat it only as an
  ownership-checked lookup hint, with the profile's pending ID taking precedence.
- Define missing/foreign/expired result handling, including the 24-hour evidence
  retention boundary.
- Handle expected non-2xx HTML responses narrowly; do not swap arbitrary server
  error bodies. Keep safe inline errors and `no-store` headers.
- Escape all server-rendered values and preserve Origin/cross-site protections.

## Validation plan

- Cover lost response without POST replay, error rendering, recovery polling,
  cross-tab state, stale price presentation, and expired result handling.

## Validation results

- The stable `#game-sync` owner coordinates recovery, session repair, requests,
  and result-ID persistence; the replaceable game fragment owns the no-queue poll.
- An uncertain POST disables controls and prompts reconciliation by GET. The
  client does not automatically replay the POST. Send errors preserve last price
  and recover on the next poll.
- A remembered guess ID is stored as a lookup hint and checked by ownership;
  current profile pending IDs take precedence. Invalid/expired IDs safely fall
  back to current game state.
- `mise exec -- pnpm test:e2e` passed 10/10 scenarios, including lost response,
  competing tabs, outage recovery, invalid identity, and result continuity after
  reload. `mise exec -- pnpm test:integration` passed 9/9.
- Task complete; no commit made.
