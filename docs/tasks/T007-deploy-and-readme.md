# T007 — Deploy and document the demo

**Goal:** Publish the working app and provide the information needed to review and run it.

**Dependency:** [T006 — Testing](T006-testing.md), with the core T002–T005
implementation and its contracts ready to deploy.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## Prerequisites and user actions

- Confirm access to a public Git hosting repository, Render account, AWS account,
  target region/table, and permission to provision resources and set secrets.
  Check current free-tier limits and arrange an AWS budget alert.
- If publishing, provisioning, or credentials require unavailable access, give
  the user concrete manual steps and request the missing action. Do not invent
  URLs, commit secrets, or claim deployment/completion while these steps are blocked.

## In scope

- Publish the reviewed source to a public repository and verify anonymous access.
  Configure one Render web service to build the React assets and serve them from
  Fastify with the API. Reuse `src/server/app.ts` static serving; bind the server
  to Render's `PORT` and an externally reachable `HOST`, not localhost.
- Choose and document actual build/start commands using Node.js 24, the pinned
  pnpm version, and frozen-lockfile installation. Verify direct frontend navigation,
  asset serving, and API routing on the deployed service.
- Provision/configure DynamoDB according to the implemented storage layout.
  Grant only required actions on the specific table/index resources; document
  the permission policy and credential setup. Store credentials and configuration
  in Render secrets/environment, never public source, browser bundles, or logs.
- Smoke-test hosted onboarding, fresh price display, submission/pending, result
  and score, and same-session reload. Verify pending state survives a service
  restart and resumes after wake; verify stale/provider-unavailable behavior
  through a safe operational method, not publicly exposed test controls. Report
  any check that could not be exercised safely.
- Replace the root planning README with a reviewer-ready README: actual public
  repository/demo URLs, functionality, local DynamoDB and credential setup,
  environment variables, `pnpm dev`, checks/build/E2E commands, implemented API
  contracts, deployment steps, and assumptions/limitations. Never include secrets.

## Diagnostics — required

- Confirm authorized access to hosted Fastify structured logs and usable safe
  request/job IDs. Verify actionable provider, storage, resolver, and session
  categories, appropriate levels, bounded repeated events, and recovery evidence;
  routine validation, success, price, or poll logging is not required.
- Add short troubleshooting instructions to README: where to find logs, correlate
  a request/job, identify provider vs storage vs resolver vs session trouble, and
  safely retry/check recovery. Do not expose diagnostics test endpoints or add an
  observability service/dependency.
- Review hosted logs and shared evidence for cookie headers, credentials/digests,
  secrets, names, raw provider payloads, and unnecessary personal data. Use sanitized
  excerpts only; if failure simulation is unsafe or access unavailable, report the
  gap and user action rather than claiming diagnostics verification.

## Contracts and handoffs

- Use T006's evidence and T002–T004's documented session, pricing, storage, and
  resolution contracts. Document sampled pricing, exact comparison, session-cookie
  loss, and Render free sleep/wake delays honestly; background work is not always on.
- Record actual provisioning/configuration choices in the owning docs and README.
  Keep deployment limitations explicit rather than adding Lambda or another service.
- Optional [T101 — Return visits](T101-return-visits.md) and
  [T102 — Leaderboard](T102-leaderboard.md) must not block the core submission.

**Out of scope:** Optional features, production-grade infrastructure, guaranteed
always-on resolution, and provisioning/publishing without user authorization.

## Acceptance criteria

- [ ] Public source and demo URLs are verified; a reviewer can play the core flow.
- [ ] One service serves frontend/API over HTTPS, uses platform PORT/HOST, and
  persists game state in DynamoDB with scoped permissions and private secrets.
- [ ] Hosted session/scoring, restart-pending recovery, and stale behavior have
  recorded evidence or clearly identified gaps; no unsupported reliability claims.
- [ ] README contains actual URLs, reproducible setup/scripts/contracts, and free
  sleep, cookie, pricing, and cost limitations. Blocked user actions remain open.

- [ ] Required hosted diagnostics/access and troubleshooting instructions are
  verified, with safe correlation, bounded failure/recovery output, and reviewed
  secret/personal-data redaction evidence or explicit outstanding checks.

## Verification to report

- Report hosted log-access/category/recovery checks and sanitized redaction evidence,
  with skips and user actions; never attach raw headers, secrets, or player records.

- Actual `pnpm check` and `pnpm build` results and deployment build/start evidence.
- Public repository access, hosted URL/API checks, and smoke-test outcomes,
  including restart/wake and stale checks, skips, and required user actions.
- Check README commands/links against the implemented app; redact all credentials.
