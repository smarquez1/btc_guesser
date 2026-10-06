# T002 — Persist player profiles and game state

**Goal:** Give each browser session a stable player identity and persist its score
and active/latest guess state in DynamoDB.

**Dependency:** [T001 — Project setup](T001-project-setup.md).

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## In scope

- Validate display-name input: trim whitespace, reject empty names, and choose
  and document a sensible length bound. Names are labels, never authentication.
- Generate player IDs on the server. Authenticate with an opaque private
  credential in a session-only HttpOnly cookie, not with the public player ID.
  Use an appropriate SameSite policy and Secure on deployed HTTPS; omit cookie
  expiry. Do not expose credentials in JSON or logs.
- Persist score and active/latest guess state in DynamoDB. New players start at
  zero with no active or latest guess. Do not use an in-memory runtime fallback.
- Provide backend operations to create a player, retrieve authenticated state,
  and submit an Up/Down guess. Reusing a valid session must preserve identity
  and progress rather than create or reset the player.
- Enforce one active guess with an atomic database condition, including concurrent
  submissions. Infrastructure failures must not masquerade as guess conflicts.
- Record the server-selected full-precision starting price, acceptance time, and
  minimum 60-second deadline. Reject client-supplied game-owned values, including
  score, price, and timestamps.

## Diagnostics — required

- Classify validation, missing/invalid session, active-guess conflict, unavailable
  price, and persistence failure in responses/tests. Routine invalid input or
  conditional conflicts need not generate a log on every request.
- Use existing Fastify structured logging/request IDs for unexpected storage or
  request failures and recovery. Choose actionable warn/error levels for degraded
  operation and info for recovery; bound/rate-limit repeated events. Correlate by
  safe request ID, not player identity, and do not add per-success logging or an
  observability dependency/service.
- Allowlist diagnostic fields; never log cookie headers, session credentials or
  digests, secrets, names, raw provider payloads, or unnecessary personal data.
  Sanitize SDK errors rather than dumping requests or stored items.

## Contracts and handoffs

- **T005 — Interface:** Document a stable JSON contract for the chosen operations:
  inputs, success statuses, public player fields, nullable active/latest state,
  and errors for invalid input, missing/invalid sessions, an active-guess conflict,
  unavailable price, and unavailable persistence.
- **T003 — Pricing:** Provide an injectable trusted-price interface. Use
  deterministic observations in tests; T003 supplies the runtime provider/cache.
  Until a valid fresh observation is available, submission fails clearly without
  writing a guess. Never substitute a placeholder or stale price.
- **T004 — Resolution:** Persist and document the fields needed for resolution.
  T004 owns resolving guesses and conditional score/result updates that prevent
  duplicate scoring; do not implement resolution or scoring here.
- Document chosen API/storage decisions in the relevant owning docs and local
  table/configuration setup in README. Include required permissions and credential
  configuration without committing secrets. Endpoint names, key layout, and
  internal abstractions are implementation choices, not prescribed by this ticket.

**Out of scope:** UI changes, Coinbase integration/cache, guess resolution,
accounts, leaderboard, guess history, and persistent return-visit sessions.
Live AWS provisioning and deployment are not required for T002.

## Acceptance criteria

- [ ] A valid name creates a player at score zero; equal names create distinct
  players in separate sessions. Invalid names and directions are rejected.
- [ ] Reloading or restarting the backend with the same store and cookie restores
  the same ID, score, and guess state. Missing, tampered, or unknown sessions
  cannot read or change another player's state.
- [ ] A submitted guess uses exact server price/time and preserves latest state;
  sequential and concurrent overlaps allow only one acceptance.
- [ ] Missing valid price data writes nothing; storage failures are distinguishable
  from conflicts. Public responses contain no private session credentials.
- [ ] API and local DynamoDB setup documentation are sufficient for T005 and T004
  to integrate without guessing the contract.

- [ ] Required diagnostics distinguish infrastructure failures from expected
  validation/auth/conflict categories, with safe correlation, bounded logs, and
  secret/personal-data redaction evidence.

## Verification to report

- Deterministic diagnostic assertions for categories, request correlation,
  repeated failure/recovery volume, and redaction of seeded secrets/names in logs
  and errors; report safe examples, not real credentials.

- Focused deterministic Fastify/Vitest tests for sessions, validation, cookie
  security, concurrency, server-owned price/time, and failure behavior.
- SDK/storage-boundary contract tests for reads and conditional writes.
- A genuine DynamoDB or DynamoDB Local persistence/conditional-write check when
  available. If only mocked boundaries ran, explicitly report that limitation;
  deterministic tests must not depend on live AWS.
- Actual `pnpm check` and `pnpm build` results, plus any skipped checks. Do not
  claim genuine database integration from mocked tests alone.
