# T003 — Integrate BTC pricing and caching

**Status:** Done — rebased onto main and revalidated; approved by the orchestrator after review and verification.

**Goal:** Provide validated, current BTC/USD observations from Coinbase Exchange.

**Scope:** Implement the BTC-USD public ticker adapter, validate and retain the provider’s full-precision price and timestamps, and add a short-lived in-process cache so browser requests share provider calls. Surface stale/unavailable state instead of treating old data as current.

**Dependencies:** [T001 — Setup](T001-project-setup.md). Coordinate the trusted-price/API boundary with [T002 — Player state](T002-player-state.md) and the resolution handoff with [T004 — Game rules](T004-game-rules.md); scoring remains T004's responsibility.

## Acceptance criteria

- Validate positive full-precision decimal strings and provider timestamps from
  `GET https://api.exchange.coinbase.com/products/BTC-USD/ticker`; reject malformed,
  stale, future-dated, non-success HTTP and failed responses without trusted data.
- Share cached/in-flight observations, preserve cache receipt time, bound fetch/body
  timeout and retries, and abort/clean up polling on shutdown. Retain last-known
  display data as stale; return unavailable when no valid observation exists.
- Emit structured diagnostics for timeout, transport, HTTP, malformed payload,
  timestamp rejection, freshness expiry and recovery. Allowlist only category,
  generated job correlation ID, elapsed/receipt age and retry delay. Never log raw
  provider payloads/errors, names, cookies or other secrets. Degraded warnings are
  rate-limited to once per 60 seconds; recovery transitions log info; routine reads
  and successful polling stay silent.
- Verify these behaviors deterministically with injected fetch/time and captured
  diagnostics, without live Coinbase requests or real-time waits.

## Implementation handoff (2026-10-06)

Implemented `src/server/pricing.ts` with exact observations/comparison, injected
fetch/time/log, shared cache/request, bounded timeout/retry/polling and lifecycle.
Player APIs add `pricing` and submission uses the shared trusted source; no
scoring or persistence behavior changes. Policies/API details are in
[README](../../README.md#btc-pricing--t003-handoff) and
[technical approach](../technical-approach.md#t003-pricing-policies-and-handoff).
Every valid new response gets a new receipt even for the same
ticker, while cache hits preserve it. Provider time is last-trade context, not an
extra deadline check. Validation is deterministic/offline.

Rebased onto `main` (`44e9cf6`) on 2026-10-06 and revalidated. Conflicts in
`src/server/app.ts`, `src/server/index.ts`, `README.md`, and
`docs/technical-approach.md` were reconciled by preserving main's T002
security/persistence changes and adding T003's pricing wiring and documentation;
the T003 player tests absent from main's `players.test.ts` were restored. No T003
pricing source changes were needed. This work was delivered as one commit; live
Coinbase health and deployment remain unverified.

Verification performed with Node.js 24.21.0 and pnpm 12.9.1, against
the already-running loopback DynamoDB Local (no infrastructure was started and
no real AWS was used):
- `pnpm exec vitest run src/server/pricing.test.ts src/server/players.test.ts src/server/app.test.ts`: 63 tests passed across 3 files.
- `pnpm check`: Biome (29 files), all TypeScript projects, all 68 Vitest tests passed across 5 files.
- `pnpm build`: client and server build passed.
- `pnpm test:integration`: passed; session/state restored across app instances and the concurrent conditional update was accepted once. Only its unique temporary test table was created and deleted.

Existing deterministic pricing tests verify diagnostic categories, generated job
IDs, elapsed/receipt age and retry delay, timeout cleanup, silent successful polls,
rate-limited warnings and recovery info. Seeded secrets in malformed payloads,
body exceptions and transport errors are absent from captured logs. Player tests
verify shared display/trusted pricing, lifecycle ownership and no submission write
with unavailable trusted data.

This ticket update is documentation-only and follows the verification above.
