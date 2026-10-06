# T103 — Automate CI checks

**Goal:** Run the project's existing checks and deterministic browser journey
automatically on pull requests and default-branch pushes.

**Dependency:** [T006 — Testing](T006-testing.md) for deterministic fixtures and
the actual Playwright script. Optional: this must not block
[T007 — Deployment](T007-deploy-and-readme.md) or the core submission. Use the
public Git host selected by T007; confirm that choice before implementing.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## In scope

- Add a small workflow for pull requests and pushes to the actual default branch
  on the selected host; use GitHub Actions if the repository is on GitHub. Inspect
  existing workflow conventions first; do not assume CI already exists.
- Use Node.js 24, pinned `pnpm@12.9.1`, and `pnpm install --frozen-lockfile`.
  Run `pnpm check`, `pnpm build`, and T006's actual documented Playwright command.
  Install the browser and operating-system dependencies that journey needs;
  do not invent a script name or add another test stack.
- Reuse T006's real frontend/backend journey with isolated deterministic clock,
  provider, and resettable store fixtures. No live Coinbase, live AWS credentials,
  real-minute waits, or production-exposed test controls. Start fixtures with
  bounded readiness checks and clean up processes/data even on failure.
- If the fixture uses DynamoDB Local, run it as an isolated local service with
  local-only dummy credentials and unique test data. If it uses a mocked/in-memory
  store, explicitly label that evidence; do not claim genuine database integration.
  Reuse the existing `test:integration` command when genuine local database checks
  are included, rather than duplicating conditional-write tests in CI tooling.
- Use minimal workflow permissions, read-only repository access where sufficient,
  and no secrets for fork pull requests. Never run untrusted PR code in a privileged
  base-repository context or with deployment credentials.
- Surface failing commands and useful bounded-retention reports/artifacts. Avoid
  sensitive cookies, credentials, or session storage in logs, traces, and uploads;
  omit or sanitize artifacts that cannot safely be published. Cache only
  reproducible dependencies if useful, keyed to lockfile/toolchain; never cache
  fixture state or secrets. Keep job timeouts and setup modest.

## Diagnostics — required if implemented

- Keep CI optional, but use named steps and preserve failing command exit codes
  when implementing it. Classify install/check/build/browser failures and fixture
  startup/readiness/cleanup failures with safe step/run correlation and useful
  bounded output. Cleanup must not hide the original test failure; a cleanup
  failure must also be visible. Avoid repeated readiness/poll spam or success logs.
- Provide minimal sanitized test reports/artifacts with bounded retention, not a
  new observability service/dependency. Never upload cookie headers, credentials,
  secrets, names, raw provider payloads, session storage, or unnecessary personal
  data; omit unsafe traces/screenshots rather than relying only on secret masking.

## Contracts and handoffs

- **T006:** Consume its scripts, browser requirements, fixture lifecycle, and
  actual-vs-mocked database evidence. Missing deterministic tooling remains a
  prerequisite, not a reason to point tests at production.
- **T007:** Reuse the selected public host and document workflow triggers, local
  reproduction commands, evidence limits, and required user enablement in README.
  Request any unavailable repository permission; do not claim hosted runs occurred.
- Keep local Lefthook/Biome/TypeScript/Vitest checks intact. CI automates existing
  checks rather than introducing a redundant quality stack or changing game rules.

**Out of scope:** Deployment automation, mandatory branch protection, production
credentials, a larger browser suite, and blocking the core release on optional CI.

## Acceptance criteria

- [ ] PRs, including fork PRs, and default-branch pushes run frozen installation,
  `pnpm check`, `pnpm build`, and the actual deterministic Playwright script.
- [ ] The journey uses a real backend and isolated fixtures without live market
  data, live AWS credentials, production controls, or timing sleeps.
- [ ] Workflow permissions are minimal; failures are visible and artifacts contain
  no sensitive session data. Database evidence and any limitations are explicit.
- [ ] Workflow setup and local reproduction are documented; hosted success is
  verified or unavailable permissions/runs are clearly reported as outstanding.

- [ ] If implemented, required diagnostics name failed steps/exit codes and fixture
  startup/cleanup failures, with bounded output and demonstrated secret/artifact
  redaction; original failures remain visible.

## Verification to report

- Exercise controlled command/fixture failures and report step/exit-code/cleanup
  evidence plus sanitized artifact review and seeded-secret/name redaction checks.

- Actual clean-install, `pnpm check`, `pnpm build`, and Playwright results, including
  fixture/browser setup and any genuine DynamoDB Local integration results.
- Workflow syntax/configuration checks and actual PR/default-branch run URLs and
  outcomes when available. Report skips, fork-secret isolation, artifact review,
  and remaining user actions without claiming unobserved hosted execution.
