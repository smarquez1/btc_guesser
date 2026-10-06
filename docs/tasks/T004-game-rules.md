# T004 — Implement guess resolution and scoring

**Goal:** Apply the assignment’s timing, comparison, one-active-guess, and scoring rules on the backend.

**Dependencies:** [T002 — Player state](T002-player-state.md) and
[T003 — Pricing](T003-btc-pricing.md).

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## In scope

- Implement pure resolution rules separately from Fastify, worker scheduling, and
  repository writes. Consume T002's persisted guess and T003's trusted observation;
  T002 still owns submission, starting price, acceptance time, and overlap prevention.
- Require elapsed server time and observation `receivedAt` to be at least
  `acceptedAt + 60 seconds`. The provider trade timestamp is context, not another
  eligibility gate. A move before the deadline counts if a fresh observation
  received at/after the deadline still differs from the starting price.
- Compare full-precision decimal values exactly, using the agreed pricing helper.
  Equal prices, pre-deadline observations, stale data, and provider failures leave
  the guess pending. Use the first eligible differing observation seen by the
  running resolver; do not promise recovery of missed market history.
- Persist the result and `+1` or `−1` score change atomically, conditioned on the
  same guess identity still being active. Clear active state and retain the latest
  result in that write. Retries, overlapping workers, or an obsolete observation
  must not score twice or resolve a replacement guess.
- Add a small bounded background resolver with injected clock/pricing/repository.
  Choose and document due-guess discovery, batch/concurrency limits, polling and
  failure retry behavior. Recover persisted pending guesses on restart/wake; an
  in-memory timer alone is insufficient. Avoid unbounded scans on every request
  or tick; a bounded demo-scale strategy is acceptable with its costs documented.
- Stop scheduling and clean up timers/in-flight work on shutdown. Persistence or
  provider failures must preserve pending state and permit subsequent recovery.

## Diagnostics — required

- Use the existing structured logger for worker start/stop, restart/wake recovery,
  discovery/write infrastructure failures, and recovery. Include safe job/run
  correlation, bounded affected counts, duration, and retry decision; do not dump
  full game records or log every poll, pending guess, or success.
- Classify already-resolved/obsolete-guess conditional conflicts as expected
  outcomes, not infrastructure errors. Use warn/error for degraded work and info
  for lifecycle/recovery; aggregate or rate-limit repeated events.
- Never log cookie headers, credentials, secrets, names, raw provider payloads,
  or unnecessary personal data. Sanitize repository errors; add no observability
  service/dependency.

## Contracts and handoffs

- **T002:** Reuse its storage layout and public state contract; agree on repository
  discovery and conditional resolution operations rather than creating a second
  player store. Distinguish an already-resolved condition from infrastructure errors.
- **T003:** Reuse exact price and freshness semantics, retaining receipt time even
  for cache hits. Store the resolving observation/result fields needed by the UI.
- **T005 — Interface:** Document pending/latest-result and score-change semantics
  within the chosen API contract, including delayed resolution after sleep/failure.
- Record discovery/recovery choices and Render sleep limitations in owning docs
  and README. Do not add Lambda or queue infrastructure for this demo.

**Out of scope:** Submission ownership, guess history, real-time trade replay,
independent cloud workers, and new UI work.

## Acceptance criteria

- [ ] No resolution occurs before the deadline or from a pre-deadline receipt;
  receipt exactly at the deadline is eligible regardless of provider trade time.
- [ ] Equal numeric decimals remain pending; a tiny full-precision difference
  resolves correctly even when rounded display prices match.
- [ ] Up/Down produces exactly `+1` or `−1`; repeated/concurrent attempts and stale
  guess identities cannot cause duplicate or replacement-guess scoring.
- [ ] Pending guesses survive failure and restart/wake and resume bounded discovery;
  shutdown leaves no active timers or uncontrolled work.

- [ ] Required diagnostics distinguish expected write conflicts from failures,
  explain lifecycle/retry/recovery with bounded counts and noise, and demonstrate
  secret/game-record redaction.

## Verification to report

- Capture deterministic worker failure/recovery diagnostics; assert classification,
  safe correlation/counts, bounded repeated events, and no seeded secrets/names or
  full records. Report redacted evidence.

- Deterministic pure-rule and worker/repository tests for timing boundaries,
  pre-deadline moves, equal/stale/unavailable prices, both directions, concurrency,
  retry, restart discovery, and cleanup; no live prices or real-minute waits.
- Conditional-write evidence against DynamoDB or DynamoDB Local when available;
  clearly separate genuine database checks from mocked boundary tests.
- Actual `pnpm check` and `pnpm build` results, plus any skipped checks.
