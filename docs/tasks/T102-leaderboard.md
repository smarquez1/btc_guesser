# T102 — Add a small leaderboard

**Goal:** Let players compare scores on a small public board.

**Dependency:** [T007 — Deployment](T007-deploy-and-readme.md). Optional: start
only after the core submission is verified; skip if it delays that work.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md), reusing
[T002 — Player state](T002-player-state.md)'s profiles and persisted scores.

## In scope

- Choose and document a small bounded top-N size, descending score order, and
  deterministic tie-break rule. Equal display names remain separate players;
  internal tie-break data need not be public.
- Choose a demo-scale DynamoDB access strategy and explain read cost, pagination,
  ranking completeness, and eventual consistency. Compare a bounded query, scan,
  or index as appropriate to the existing layout; do not mandate a GSI or add
  unbounded scans per browser request. A truncated scan is not a global top-N:
  document any bounded population assumption or approximate result honestly.
- Return only safe display names and scores. Escape names through normal text
  rendering; never return private credentials or internal player IDs, including
  through pagination metadata. Bound public requests and response sizes.
- Add a small read-only interface with loading, empty, and unavailable states.
  Explain that score changes may appear after a delay; board reads must not
  interfere with submission or conditional scoring.

## Diagnostics — required if implemented

- Keep this feature optional, but classify query/read failure, configured limit or
  completeness constraints, and recovery when implementing it. Use Fastify's
  structured logger/request IDs with safe timings/counts and appropriate warn/error
  or recovery info levels; aggregate/rate-limit repeated failures or limit events,
  not every board read. UI errors distinguish server vs network failures and reuse
  available request correlation.
- Never log returned identities/names, records, cookie headers, credentials,
  secrets, raw provider payloads, or unnecessary personal data. Sanitize errors and
  keep completeness information truthful without disclosing internal identifiers;
  add no observability service/dependency or client telemetry endpoint.

## Contracts and handoffs

- Agree on the endpoint/response and UI integration with T002/T005 conventions;
  these are implementation choices, not pre-existing contracts.
- Document top-N, ties, query/scan/index limits and consistency in owning docs
  and README. Update deployment permissions only for resources/actions actually
  required by the chosen strategy.

**Out of scope:** Accounts, guess history, global rank for every player, real-time
updates, and infrastructure that delays the core game.

## Acceptance criteria

- [ ] A bounded board orders highest scores and ties deterministically, including
  duplicate names and negative scores; empty/unavailable states are understandable.
- [ ] Public payloads/rendered names disclose no credentials/internal IDs and
  cannot execute markup. Reads do not alter scores or active guesses.
- [ ] Access cost, pagination/completeness, population limits, and eventual
  consistency are documented accurately for the chosen demo-scale strategy.

- [ ] If implemented, required diagnostics explain read failures/limits/completeness
  and UI recovery with safe correlation, bounded output, and secret/identity redaction.

## Verification to report

- Capture deterministic read-limit/failure/recovery and UI diagnostic evidence;
  assert categories, bounded volume, and redaction of seeded secrets/names/identities.

- Deterministic repository/API tests for ordering, ties, limits, pagination where
  relevant, safe fields, and failures; UI tests for names and board states.
- Genuine DynamoDB/DynamoDB Local query evidence when available, distinguished
  from mocks; actual `pnpm check` and `pnpm build` results and skipped checks.
