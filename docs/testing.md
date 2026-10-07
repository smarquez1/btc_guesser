# Test verification (T006)

This document is the gap-closing matrix for the core game journey. It maps each
critical behavior to named, passing evidence and states where a row is a known
gap. It complements the task board (`docs/tasks/README.md`) and the deployment
handoff in [T007](tasks/T007-deploy-and-readme.md).

## How to run

| Command | Scope | Requires |
|---|---|---|
| `pnpm test` | Deterministic Vitest suites (Node + jsdom), no network | Nothing |
| `pnpm test:integration` | Real persistence against DynamoDB Local | Loopback DynamoDB Local + `DYNAMODB_ENDPOINT` |
| `pnpm test:e2e` | Focused Playwright browser journey against the real app + DynamoDB Local | Chromium (see below) + loopback DynamoDB Local |
| `pnpm check` | Biome, all TypeScript projects, `pnpm test` | Nothing |
| `pnpm build` | Client + server production build | Nothing |

Playwright browser install (one-time per machine/CI cache):

```sh
pnpm exec playwright install chromium
```

## Evidence matrix

Statuses: **covered** = a named passing test asserts the behavior; **gap** = no
direct evidence yet.

### Vitest rules / pricing (`src/server/resolution.ts`, `pricing.ts`)

| Behavior | Evidence | Status |
|---|---|---|
| Exact decimal comparison (scale, leading zeros, full precision) | `src/server/pricing.test.ts` "compares full precision, unequal scales and leading zeros exactly"; `src/server/resolution.test.ts` "keeps equal values pending across precision and leading zeros", "resolves a full-precision difference that rounds to the same display price" | Covered |
| Receipt-time deadline boundaries (before/at deadline) | `src/server/resolution.test.ts` "keeps a pre-deadline receipt pending even after the deadline", "treats a receipt exactly at the deadline as eligible" | Covered |
| Pre-deadline move still present afterward | `src/server/resolution.test.ts` "keeps a differing price pending before the deadline"; "counts a pre-deadline move that is still different at the post-deadline check" | Covered |
| Pre-deadline move that reverts before the check stays pending | `src/server/resolution.test.ts` "keeps a guess pending when a pre-deadline move has reverted by the check" | Covered |
| Provider trade timestamp is context, not a gate | `src/server/resolution.test.ts` "ignores the provider trade timestamp for eligibility" | Covered |
| Equal / stale / failed data stays pending | `src/server/resolution.test.ts` (equal); `src/server/resolver.test.ts` ineligible/equal/unavailable non-writing sweep | Covered |
| Cache and single-flight recovery | `src/server/pricing.test.ts` shared-request/cache-receipt, stale-after-failure + cooldown + recovery, expiry without reads refreshing receipt | Covered |
| Acceptance-window configuration (`GUESS_MIN_WAIT_MS`) | `src/server/players.test.ts` "guess minimum wait from GUESS_MIN_WAIT_MS" (absent/`0`/non-numeric/negative → 60000; override yields the configured window) | Covered |

### Fastify / repository (`src/server/players.ts`, `dynamodb.ts`, `resolver.ts`)

| Behavior | Evidence | Status |
|---|---|---|
| Session isolation and reload | `src/server/players.test.ts` distinct IDs for equal labels + restore across app instances, cookie rejection cases; `src/server/db-integration.ts` HTTP restore after app rebuild | Covered |
| Server-owned values (price, timestamps) | `src/server/players.test.ts` concurrent acceptance with exact server price/time, acceptance window; `src/server/resolution.test.ts` provider timestamp ignored | Covered |
| Overlap prevention (one active guess) | `src/server/players.test.ts` concurrent submissions `[201,409]`; `src/server/dynamodb.test.ts` atomic active-guess update condition | Covered |
| Conditional scoring exactly once | `src/server/dynamodb.test.ts` pinned-guess resolve + obsolete-conflict mapping; `src/server/db-integration.ts` concurrent resolves score once | Covered |
| Persistence failure and pending restart recovery | `src/server/players.test.ts` persistence failure not masked as conflict; `src/server/player-diagnostics.test.ts` unavailable/throwing price vs persistence; `src/server/resolver.test.ts` recover persisted guesses on fresh instance | Covered |
| Bounded due discovery / cursor | `src/server/dynamodb.test.ts` one bounded scan page + cursor, fresh sweep per page | Covered |
| Real-DB concurrency evidence | `src/server/db-integration.ts` (unique isolated table on DynamoDB Local, conditional-write concurrency, no double scoring) | Covered |
| Resolver restart recovery | `src/server/db-integration.ts` (persisted due guess discovered from the real table by a fresh resolver, scored once, second resolve rejected) | Covered |
| Persistence unavailable (real SDK) | `src/server/db-integration.ts` (missing table → `503 persistence_unavailable`, no write, no internals leaked) | Covered |

### React Testing Library (`src/client/**`)

| Behavior | Evidence | Status |
|---|---|---|
| Onboarding validation | `src/client/App.test.tsx` onboarding describe | Covered |
| Loading / error / stale display | `src/client/App.test.tsx` session lifecycle + price states; `src/client/components/game/PricePanel.test.tsx` | Covered |
| Pending controls | `src/client/App.test.tsx` guess flow; `src/client/components/game/GuessPanel.test.tsx` controls | Covered |
| Result and score update | `src/client/App.test.tsx` resolved results; `PricePanel.test.tsx` revealed price does not disturb score/result | Covered |
| Session restore | `src/client/App.test.tsx` session lifecycle; `src/client/diagnostics.redaction.test.tsx` restore labels | Covered |
| Client cannot resolve locally | `src/client/game/machine.test.ts`, `src/client/App.robustness.test.tsx` (countdown/reconcile) | Covered |

### Playwright (real browser journey)

| Behavior | Evidence | Status |
|---|---|---|
| Onboarding → submit → pending → resolution → score update → reload against the real Fastify app and DynamoDB Local, with controlled time/price and no live Coinbase | `tests/e2e/core-journey.spec.ts` "core journey: onboard, guess, resolve, score, and persist" | Covered |

### Diagnostics and redaction (across boundaries)

| Behavior | Evidence | Status |
|---|---|---|
| Classification and request/job correlation | `src/server/player-diagnostics.test.ts` correlation + exact field set; `src/server/pricing.test.ts` classified categories; `src/client/diagnostics.test.ts`; `src/client/diagnostics.redaction.test.tsx`; `src/client/api.test.ts` | Covered |
| Bounded repeated failure and recovery | `src/server/player-diagnostics.test.ts`; `src/server/pricing.test.ts` rate limiting; `src/server/resolver.test.ts` degrade-once/recover; `src/client/diagnostics.test.ts` | Covered |
| Secret / personal-data redaction (API, provider, repository, worker) | `src/server/player-diagnostics.test.ts` seeded-secret `assertPrivate`; `src/server/resolver.test.ts` seeded-error redaction; `src/server/players.test.ts` response-body redaction | Covered |
| Browser-console redaction (real browser) | `tests/e2e/core-journey.spec.ts` (no seeded name/credential/token and no unexpected console errors or page errors) | Covered |
| HttpOnly session credential (real browser) | `tests/e2e/core-journey.spec.ts` (`context.cookies()` httpOnly; `document.cookie` hides `btc_player`) | Covered |
| Safe failure artifacts | Playwright artifacts disabled (`trace`/`screenshot`/`video` off) | Covered |

## Fixture requirements and database evidence

- Unit/API tests inject the clock, price observation source, and store; they never
  contact Coinbase or wait a real minute.
- `pnpm test:integration` is genuine DynamoDB Local evidence: unique test table,
  conditional-write concurrency, cleanup of only that table. It is not mocked.
- The Playwright journey uses a test-only launcher (`tests/e2e/server.ts`) that
  builds the real Fastify app with an isolated DynamoDB Local table, an injected
  ticker fetch, the runtime `GUESS_MIN_WAIT_MS` seam (default 60000, set to 1000
  for the journey), and a fast resolver poll, plus a loopback-only control channel
  to set price and reset state. Controls live only in the test fixture; no test
  endpoints or switches exist in the deployed application.
- Browser timers are driven by Playwright's context clock (`context.clock.install()`
  before navigation; `page.clock.runFor` to fire the poll timer) instead of real
  waits, and the client arms the pending 5s poll cadence at guess acceptance
  (regression-tested in `src/client/App.test.tsx`).
- `GUESS_MIN_WAIT_MS` is a documented runtime setting (`.env.example`, README); the
  browser journey exercises the real acceptance-window path rather than a test-only
  store wrapper.

## Actual results (2026-10-06)

| Command | Result |
|---|---|
| `pnpm check` | Biome 76 files, no fixes; 4 TS projects pass; Vitest 17 files / 210 tests passed |
| `pnpm build` | Client Vite build + server `tsc` passed |
| `pnpm test:integration` | Passed on real DynamoDB Local, including restart recovery and the real `503 persistence_unavailable` check |
| `pnpm exec playwright install chromium` | Succeeded (Chromium already cached) |
| `pnpm test:e2e` | 1 passed (~6.3s total; journey ~4.5s); isolated table removed; dev table untouched |

## Remaining gaps

- T006 scope is complete: every matrix row has passing evidence and none is an
  explicit gap.
- Live Coinbase provider health, AWS IAM, and the public deployment are out of
  scope here and belong to [T007](tasks/T007-deploy-and-readme.md).
- The browser journey runs in ~4.5s (total ~6.3s). Playwright's clock fires the
  client poll timer and the client now arms the pending 5s cadence at acceptance;
  the remaining time is the real server resolution wait, not a browser timer.
