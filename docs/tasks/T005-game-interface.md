# T005 — Build the game interface

**Goal:** Implement a responsive, accessible interface for joining a browser
session, making an Up/Down guess, and understanding its pending state and result.

**Status:** Done — accepted by the user and verified against the running backend.

**Dependencies:** the documented contracts from [T001](T001-project-setup.md)–[T004](T004-game-rules.md).
Coordinate UI test tooling with [T006 — Testing](T006-testing.md), which still
owns the browser end-to-end journey.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md). Design reference:
[Game mockup](../mockup.pen) ([T008](T008-game-mockup.md)), adapted to mobile and
to all loading, pending, result, and error states with standard shadcn/ui + Tailwind.

## Requirements

- Check the session before onboarding: loading → valid session enters play;
  missing session → display-name onboarding; network/server failure → retry, not a
  new player. Names are labels, not credentials.
- Play view: score, latest BTC/USD price, labelled Up/Down actions, and the active
  guess or latest result. Handle null active/latest cleanly; never fabricate a
  price or resolve locally.
- Submit/reconcile: send only `{direction}`; block duplicate submissions and a new
  guess while one is active; reconcile with server state after success, conflict,
  or an uncertain response; failures must not erase identity, score, or guess state.
- Waiting/results: the countdown is a display aid from server fields (60 seconds is
  a minimum); results and score changes come only from the server.
- Refresh safely: poll the backend (never Coinbase), bounded and non-overlapping,
  clean up on unmount, reject stale responses; reload hydrates state; credentials
  stay in the HttpOnly cookie.
- Responsive + accessible: semantic controls, visible focus, associated
  labels/errors, non-color-only status, restrained announcements.
- Diagnostics: classify validation/session/conflict/provider/storage/network
  errors; allowlisted, bounded, DEV-only output; no secrets, names, or payloads.

## Acceptance criteria

- [x] Session checking distinguishes loading, onboarding, restored play, and
  retryable failure; reuse never creates or resets the player.
- [x] Play shows score and the latest price in every state (fresh / stale /
  unavailable), tinted green/red by the last resolved move between rounds with a
  ▲/▼ cue and no freshness timer; Up/Down sit above the notification and the
  previous result hides while a guess is pending.
- [x] Submission can't be duplicated; an active guess blocks new guesses; success,
  conflict, and uncertain outcomes reconcile; failures preserve progress.
- [x] The countdown cannot resolve a guess or change the score; results and score
  changes come only from the server.
- [x] Reload restores score and active/latest state; credentials stay HttpOnly.
- [x] Polling is bounded, cleaned up on unmount, and can't be overwritten by stale
  responses; the browser never calls Coinbase.
- [x] Desktop/mobile are readable and usable with labelled controls, focus, and
  restrained announcements.
- [x] Integrated with the real T002–T004 contracts; diagnostics distinguish
  server/network errors and redact secrets/names.

## Implementation handoff (2026-10-06)

- `src/client/game/types.ts` — frozen client seam (`PlayerState`, `Pricing`,
  `ActiveGuess`/`LatestGuess`, `ApiError`, `GameController`, `remainingSeconds`).
- `src/client/api.ts` — thin same-origin JSON client; reports the backend error
  code and status, rethrows aborts, captures `x-request-id` defensively.
- `src/client/game/useGame.ts` — one plain `useState`/`useEffect` hook (no reducer):
  recursive `setTimeout` polling (5s active / 15s idle) with no overlap, a
  monotonic sequence gate for stale responses, abort on unmount, a 1s countdown
  clock only while pending, authoritative reconciliation. A session failure
  preserves a known player (stays ready); an unknown session → onboarding.
- `src/client/components/game/**` + `App.tsx` — every state from `GameController`
  with standard shadcn/Tailwind (only `input`/`card` added); copy centralized in
  `copy.ts`; the price tint comes from the server's resolved result, so the client
  never compares prices.

Note (post-review): the client was later reduced to a thin presentation layer — the
reducer state machine, the client diagnostics reporter, and the duplicated decimal
comparator were removed. See `refactor(client): reduce the frontend to thin
presentation` in git history for the current structure.
- Test tooling: `vitest.config.ts` uses Vitest 5 `projects` (`server` = node,
  `client` = jsdom + `src/client/test/setup.ts`); added RTL, user-event, jest-dom,
  and jsdom. T006 still owns the Playwright journey.

Decisions (not game rules): 5s/15s poll cadence; the live price is always visible
and tinted by the last resolved move only between rounds; no freshness timer;
Up/Down above the notification with the previous result hidden while pending; the
countdown shows `eligibleAt - now` and never resolves. An earlier checkpoint model
and a per-poll movement indicator were dropped. `startingPrice` is the server's
current trusted price at acceptance, and the minimum wait is 60 seconds.

## Verification

- `pnpm check`: Biome (70 files), all TypeScript projects, **209 Vitest tests
  across 17 files**.
- `pnpm build`: client and server build passed.
- Deterministic RTL tests cover session/onboarding, play, nullable state, countdown
  expiry, results, reload hydration, fresh/stale/unavailable prices, duplicate
  submission, conflict reconciliation, uncertain-submit blocking, bounded polling,
  stale responses, unmount, failure preservation, diagnostics categories /
  request-id / operation labels, bounded output, and seeded name/secret redaction.
- Manual browser pass (Pencil integrated browser against the running app):
  onboarding validation; play with a live Coinbase price; guess → pending with
  disabled controls; reload restored the active guess with `document.cookie` empty;
  the server resolved "Incorrect · Score −1"; 360px mobile had no clipping; the
  final live-price flow (tint, button order, hidden previous result) was observed
  end-to-end.

## Gaps / non-claims

- T006's Playwright journey is not implemented (delegated).
- Focus-visible was verified by construction, not an automated focus assertion.
- The integrated browser could not reset the HttpOnly session (`Network` CDP domain
  unavailable), so onboarding was exercised before creating the player.
- Live Coinbase health and deployment remain T003/T007 concerns.
