# T005 — Build the game interface

**Goal:** Implement a responsive, accessible interface for joining a browser
session, making an Up/Down guess, and understanding its pending state and result.

**Status:** In progress. This expanded prompt does not mark implementation complete.

**Dependencies:** [T001 — Project setup](T001-project-setup.md) and the documented
contracts from [T002 — Player state](T002-player-state.md),
[T003 — Pricing](T003-btc-pricing.md), and
[T004 — Game rules](T004-game-rules.md). Coordinate UI test tooling and browser
coverage with [T006 — Testing](T006-testing.md).

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

**Design reference:** [Game mockup](../mockup.pen), the basic desktop reference
from [T008 — Game mockup](T008-game-mockup.md). T008 is already user-confirmed
done; this prompt does not reopen its visual validation. During implementation,
inspect the encrypted mockup through pen.dev tools, not file-reading tools. This
prompt does not claim a fresh inspection or specify unseen design details. T005
owns adapting the reference to mobile and to all loading, pending, result, and
error states. Use standard shadcn/ui components and Tailwind, not a bespoke theme.

## Starting point

The client is currently a starter in `src/client/App.tsx`, with no game API yet.
Do not assume the backend routes or response shapes already exist. T002 owns
endpoint and storage decisions; T003 and T004 supply runtime pricing and
resolution. Deterministic fixtures can support UI work while those contracts are
being delivered, but fixtures alone do not establish working integration.

## In scope — implementation sequence

1. **Confirm the contracts and reference.** Read the owning tasks' documented
   contracts and inspect the desktop mockup through pen.dev before implementing
   its layout. Keep API access separate from rendering so loading, success, and
   failure states can be tested without a live backend. Minor layout details and
   polling/feedback durations are implementation choices; document relevant
   choices without changing the game rules.
2. **Check the session before onboarding.** On initial load, show a loading state
   while retrieving authenticated player state. A valid session enters play with
   its existing score and nullable active/latest guess. A confirmed missing or
   invalid session shows display-name onboarding; a network or server failure
   shows retry/recovery, not an assumption that the player is new. Provide a
   labelled input, useful validation feedback aligned with T002's name rules, and
   a pending creation state that prevents duplicate submissions. Names are
   labels, not login credentials.
3. **Build the play view.** Show the player's score and current BTC/USD price,
   clearly labelled Up/Down actions, and the active guess or latest result when
   present. Handle null active/latest state without placeholder results. Format
   prices for display only: the client must not compare rounded prices or
   calculate outcomes. Distinguish a fresh price, a last-known price marked
   stale/unavailable, and no available price. Do not display a fabricated value
   or imply stale data can start or resolve a guess.
4. **Submit and reconcile.** Send only the input allowed by the documented
   contract. Disable repeated submissions while a request is in flight and
   prevent a new guess while an active guess exists. After a successful mutation
   or an active-guess conflict, reconcile with authoritative server state rather
   than guessing whether the request succeeded. If a response is lost or the
   outcome is uncertain, retrieve state before allowing a repeat submission.
   Explain invalid input, unavailable price, conflicts, session recovery, and
   unavailable persistence/server errors distinctly where the contract allows.
   Transient failures must not clear identity, reset the score, or erase a known
   active guess/result.
5. **Show waiting and results honestly.** Base the local countdown on the
   server-provided acceptance/deadline fields; it is a display aid, not a game
   clock. Zero means checking or waiting for the server, never automatic
   resolution or re-enabling guesses. Explain that 60 seconds is a minimum:
   unchanged price or unavailable fresh data can leave the guess pending beyond
   the deadline. Only show the specific reason when the server reports it;
   otherwise use a general waiting message. Display the server-confirmed result
   and score change without applying a local score adjustment.
6. **Refresh and restore safely.** Poll the shared backend, never Coinbase from
   the browser. Use a bounded cadence with no overlapping requests or tight retry
   loops, clean up timers/requests on unmount, and prevent stale responses from
   overwriting newer state after mutations or session changes. Reconcile again
   when needed after errors. Reloading within the same browser session must
   hydrate identity, score, active guess, and latest result from the backend,
   including a guess that resolved while the page was away. Keep private session
   credentials in the backend's HttpOnly cookie; never read, copy, or store them
   in client state, localStorage, or sessionStorage.
7. **Finish responsive and accessible states.** Adapt the standard components
   and Tailwind layout for desktop and narrow mobile screens without clipped
   prices, unreadable status text, or inaccessible controls. Use semantic controls,
   visible keyboard focus, associated labels/errors, and status text that does
   not rely on color alone. Announce important loading/error/result changes
   appropriately, but do not announce every countdown tick or price poll. Keep
   controls and focus stable during refreshes.

## Diagnostics — required

- Classify API validation/session/conflict/provider/storage errors separately from
  browser network failures. Associate server failures with the existing backend
  request ID when available; do not invent one for a response never received.
  Keep actionable recovery within the already specified error interactions;
  failures must not erase known player/guess state.
- Safe development/browser diagnostics may record category, operation, and request
  ID, never cookie headers, session credentials, secrets, names, raw payloads, or
  unnecessary personal data. Bound repeated polling-error output and avoid routine
  success/state logs. Add no telemetry SDK, public logging endpoint, or observability
  service; this requirement changes no layout, interactions, or copy specification.

## Contracts and handoffs

- **T002 — Player state:** Consume its chosen session-check, player-creation,
  authenticated-state, and guess-submission operations. Confirm input validation,
  cookie behavior, public player fields, nullable active/latest fields, success
  responses, and distinguishable errors before integration. Do not invent settled
  endpoint names, storage layout, or client-owned score/price/time fields here.
- **T003 — Pricing:** Consume the shared backend's price and freshness information,
  including the difference between last-known stale data and no observation.
  Agree how it is exposed using the owning contract; this task does not choose
  provider polling or freshness thresholds.
- **T004 — Game rules:** Consume authoritative active/pending/result state,
  deadline fields, and score changes. Confirm any exposed pending reason and
  result fields needed for clear feedback; do not infer resolution from local
  time or displayed price.
- **T006 — Testing:** Coordinate the smallest necessary React Testing Library/DOM
  setup and deterministic UI fixtures. Existing Vitest runs in Node and includes
  `**/*.test.ts`; RTL/DOM tooling is not installed. Do not assume TSX UI tests
  already run or add a broad testing stack. T006 owns the small end-to-end browser
  journey; T005 should make its UI states testable and report integration gaps.

**Out of scope:** Backend endpoints/storage design, provider integration/cache,
resolution or scoring logic, leaderboard, persistent return visits after browser
closure, guess history, accounts or cross-device recovery, market streaming,
bespoke theming, and reopening the completed T008 design task.

## Acceptance criteria

- [ ] Initial session checking distinguishes loading, onboarding, restored play,
  and retryable failure. Creating a player shows its server-provided initial
  score; reusing a valid session never creates or resets that player.
- [ ] Play shows score and BTC/USD price with clear fresh, stale last-known, and
  no-price states. Null active/latest data is handled cleanly.
- [ ] Up/Down submission cannot be duplicated through repeated clicks, and an
  active guess blocks further guesses. Success, conflict, and uncertain outcomes
  reconcile with server state; failures do not reset session progress.
- [ ] The countdown cannot resolve a guess or change the score. Beyond-deadline
  pending states explain the minimum wait and fresh/different-price requirement;
  results and score changes come only from the server.
- [ ] In-session reload restores score and active/latest state, including results
  resolved while away. Session credentials remain exclusively in the HttpOnly
  cookie, not client-readable storage or responses.
- [ ] Backend polling is bounded, cleans up on unmount, and cannot overwrite newer
  state with an old response. The browser never requests Coinbase directly.
- [ ] Desktop and mobile remain readable and usable with keyboard focus, labelled
  controls, adequate contrast, and restrained accessible status announcements.
- [ ] The UI is integrated with the actual T002–T004 contracts; any fixture-only
  work or unavailable backend integration is reported rather than called complete.

- [ ] Required diagnostics distinguish server/network errors, preserve known state,
  and use available safe request correlation; browser/development output is bounded
  and has demonstrated secret/personal-data redaction.

## Verification to report

- Deterministic UI tests for diagnostic categories, available/absent request IDs,
  failure-state preservation, bounded repeat output, and console/error redaction
  with seeded credentials/names; report safe browser diagnostic evidence.

- Deterministic React Testing Library tests for initial loading/session checks,
  display-name onboarding, play, nullable state, pending/countdown expiry, server
  results, in-session reload hydration, and errors/recovery. Include duplicate
  submission prevention, conflict reconciliation, stale/no-price displays, and
  stale-response/unmount behavior. Inject time and API responses; do not rely on
  live Coinbase or wait a real minute. Report whether the coordinated DOM/test
  setup is available and which UI tests actually ran.
- Actual `pnpm check` and `pnpm build` results. Passing the existing Node-only
  suite is not evidence that UI tests were discovered or passed.
- Manual desktop and mobile checks for the reference layout adaptation, loading
  and error feedback, keyboard navigation/focus, contrast, and live-update noise.
- Report actual backend integration evidence and any checks delegated to T006,
  blocked, or skipped, with reasons. Do not claim browser or visual validation
  from fixtures alone, or mark the task complete before review and verification.
