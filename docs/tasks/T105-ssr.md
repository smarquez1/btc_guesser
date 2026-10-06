# T105 — Server-render the game shell (SSR)

**Goal:** Improve first paint / perceived load by server-rendering the initial game
shell, while keeping the game rules, backend authority, and single-app deployment
unchanged.

**Status:** Ready (nice to have). Requires an explicit architecture decision before
implementation.

**Dependency:** [T005 — Game interface](T005-game-interface.md) and
[T007 — Deployment](T007-deploy-and-readme.md). Do not start until T005's client
structure is settled.

**Architecture note:** SSR is a rendering/deployment change that the current
[technical approach](../technical-approach.md) does not cover. Before implementing,
record the decision and chosen approach in `technical-approach.md`. If it conflicts
with the documented "React build + Fastify API together as one small application,"
resolve that explicitly rather than silently deviating. Keep Fastify as the server
where practical.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## Hard constraints — no rule changes

- Resolution, scoring, pricing, session identity, and the 60-second minimum stay
  unchanged and server-authoritative. SSR must not move any of that into client
  rendering.
- The initial HTML must never contain session credentials, cookie contents, other
  players' state, or internal player IDs.
- Hydration must not cause duplicate guesses/submissions, re-fire celebrations,
  reset score/active-guess state, or produce countdown/price mismatches.

## In scope

- **Choose the approach.** Compare a minimal Vite/React SSR pass rendered by
  Fastify (for example `renderToString` + `hydrateRoot`) against migrating to a
  framework (Next/Remix). Prefer the smallest change consistent with the documented
  stack; justify any framework migration and any dependency it adds.
- **Render the safe shell.** Server-render the static layout and only
  non-authoritative initial markup. Keep interactive behavior (countdown, price
  polling, reveal, confetti, keyboard guessing, submission) client-side after
  hydration.
- **Pass player state safely.** Read the HttpOnly session cookie server-side only;
  never embed credentials. If initial state is injected, inject only the same
  public fields the API already returns. Player-specific HTML must never be shared
  or cached across players.
- **Hydration safety.** Render neutral/placeholder states where client-only values
  (live price, countdown, price color) would otherwise mismatch, then reveal after
  hydration. No visual flash and no duplicated effects.
- **Preserve behavior.** Keep the responsive/accessibility behavior and
  reduced-motion handling from T005/T104 intact.
- **Document deployment impact.** Cover Render free-tier behavior (cold start /
  sleep) and the build/run command changes, and report the actual measured benefit.

## Diagnostics — reuse, do not expand

- Reuse existing diagnostics; classify SSR render/hydration and render-time state
  fetch failures safely with bounded output. Add no telemetry and never log cookie
  headers, credentials, names, or personal data.

## Contracts and handoffs

- **T005:** Reuse its components; SSR must render the same UI and hydrate into the
  same behavior.
- **T104:** Coordinate so client-only effects (reveal, confetti, price color,
  keyboard) are hydration-safe.
- **T007:** Keep one deployable app; document build/run changes and host
  implications.
- Confirm no change to T002–T004 contracts and expose no new API fields.

**Out of scope:** Any game-rule change; moving resolution/scoring/pricing/session
logic to the browser; SEO or marketing concerns; splitting into multiple services;
persistent return visits; leaderboard.

## Acceptance criteria

- [ ] The initial HTML is server-rendered and hydrates cleanly with no mismatch
  warnings, no duplicate submissions, and no re-fired celebrations.
- [ ] No credentials, cookie contents, other players' state, or internal IDs appear
  in the HTML, and player-specific HTML is never shared across players.
- [ ] Interactive behavior (countdown, price coloring, reveal, confetti, keyboard,
  submission) is unchanged after hydration and stays rule-compliant.
- [ ] The architecture decision and measured benefit are documented, and the app
  remains a single deployment.
- [ ] A failed render-time state fetch still yields a usable client app.

## Verification to report

- Deterministic tests for SSR output (safe fields only, no credential leakage),
  hydration without mismatch or duplicate effects, and render-time failure
  fallback.
- Manual comparison of first paint against the SPA baseline.
- Actual `pnpm check` and `pnpm build` results, plus `pnpm test:integration` if the
  change touches persistence.
- An honest report of the measured benefit; if negligible, say so.
