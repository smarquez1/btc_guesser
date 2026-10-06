# T101 — Remember players after the browser closes

**Goal:** Restore the player’s score and active guess on a later visit in the same browser.

**Dependency:** [T007 — Deployment](T007-deploy-and-readme.md). Optional: start
only after the core submission is verified; skip if it delays that work.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md), and reuse
[T002 — Player state](T002-player-state.md)'s session contract.

## In scope

- Reuse the existing opaque private credential and DynamoDB session/player
  mapping. Make the cookie persistent with a chosen, documented bounded lifetime;
  do not replace the session system or authenticate by name/public player ID.
- Choose and document matching server-side credential expiry, retention/cleanup,
  and revocation behavior. Expired/revoked credentials must stop authenticating
  even if database cleanup is delayed. Explain whether returning extends expiry;
  avoid silently making sessions permanent.
- Preserve HttpOnly, appropriate SameSite, and Secure on HTTPS, and keep private
  credentials out of responses/logs. Losing, clearing, or expiring the cookie
  returns to onboarding; create a new player only after a valid name is submitted,
  never by automatically guessing a previous identity.
- Restore the same score and pending/latest guess with a valid returning session.
  Explain browser privacy/settings, private mode, and session-restore caveats:
  browser close behavior alone is not a reliable expiry guarantee.

## Diagnostics — required if implemented

- Keep this feature optional, but classify expiry/invalid or revoked authentication,
  onboarding recovery, and unexpected credential-store failures when implementing
  it. Do not disclose identity or detailed credential validity to unauthenticated
  callers; routine expiry does not require logging every request.
- Reuse Fastify structured logging/request IDs for unexpected failure/recovery,
  with warn/error for degradation, info for recovery, and bounded repeated events.
  Never log cookie headers, credentials/digests, secrets, names, raw payloads, or
  unnecessary personal data. No new observability service/dependency or success logs.

## Contracts and handoffs

- Keep T002's public player/state API unchanged where possible. Document any
  expiry/error contract changes for T005 and update README's privacy/lifetime
  limitations plus the relevant owning docs.
- Select lifetime/retention as implementation choices, not new account/recovery
  requirements. Clearing a browser cookie loses access; it does not necessarily
  delete the stored player or revoke a copied credential.

**Out of scope:** Passwords, cross-device recovery, identity lookup by display
name, a new session framework, and mandatory account-management UI.

## Acceptance criteria

- [ ] A valid persistent cookie restores the same player and progress after a
  simulated browser close/reopen; pending guesses are not reset.
- [ ] Missing, cleared, expired, revoked, or tampered credentials cannot restore
  state; onboarding requires a valid name before creating another player.
- [ ] Cookie security is unchanged; bounded lifetime and credential retention,
  expiry enforcement, revocation, and privacy caveats are documented.

- [ ] If implemented, required diagnostics classify expiry/auth recovery safely,
  distinguish infrastructure failure, and demonstrate bounded logs plus
  credential/identity redaction.

## Verification to report

- Deterministic expiry/failure/recovery diagnostic assertions, safe request
  correlation and repeat-volume checks, and seeded-secret/name redaction evidence.

- Deterministic API tests with injected time for lifetime boundaries, revocation,
  invalid sessions, and state restoration; no timing sleeps.
- Browser coverage that preserves persistent cookies across a simulated restart
  and exercises clearing them; distinguish that from real browser privacy policy.
- Actual `pnpm check` and `pnpm build` results and relevant browser test outcomes,
  including any skipped checks.
