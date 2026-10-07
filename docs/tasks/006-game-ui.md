# Game UI

Depends on: 001, 005.
Read docs/ui.md and inspect the retained .pen mockup before implementation.

## Acceptance criteria
- Implement a simple desktop game UI with React, semantic native HTML, and minimal Tailwind styling. Use the mockup as a loose guide; exact styling, spacing, and typography are not required. Prioritize minimal markup and CSS.
- Use native buttons and browser behavior, with visible keyboard focus and clear selected/disabled states. Do not add a UI component library or custom component system.
- Use uppercase direction labels, green for GUESS HIGHER and red for GUESS LOWER; fill the selected button with its direction color while pending.
- Retain Tailwind dependencies, the Vite plugin, and the CSS import. Remove unused shadcn configuration, dependencies, helpers, and MCP configuration; update the lockfile and setup documentation as needed.
- Use a single desktop screen with inline state changes, guided by the 16:10 mockup; do not create extra screens or routes for pending, results, loading, or errors.
- Keep both direction buttons visible. Disable both while pending, highlight the selected direction, and re-enable them after resolution. Start the next guess directly from those buttons; no Try again screen or action.
- Always display score and latest available BTC/USD price.
- Support anonymous identity, guess submission, pending state, results, and errors.
- Render server state; countdowns are presentation only.
- Prevent duplicate submissions in the UI and handle backend rejection clearly.
- Verify meaningful UI changes with Playwright on desktop. Mobile/tablet layouts and verification are out of scope.

## Validation and limitations

- Countdown wording now says “Checking begins in …” because resolution can take
  longer than 60 seconds when prices remain equal or eligible data is unavailable.
  Updated the existing happy-path assertions to match; game rules are unchanged.
- Wording validation: the existing Playwright happy path passes (one test,
  5.6 seconds overall), including countdown, resolution, and score persistence.

Implementation is in progress; browser verification is pending. Keep this task
`in-progress` until acceptance criteria and verification are recorded.

- On 2026-10-07, the user confirmed that Tailwind stays, native HTML and minimal
  styling take priority, and the mockup is only a guide. No UI component library
  or exact visual reproduction is required.
- Inspected ready and success mockups with pen.dev before implementation.
- Initial React UI and API calls are present for identity, price, submission,
  pending countdown, results, and inline errors. These changes still need review
  and browser verification; they are not yet approved or validated.
- Tailwind dependencies, Vite integration, and CSS import are restored. Unused
  shadcn configuration and helper dependencies have been removed.
- Playwright installation is authorized if needed for direct desktop verification.
  No browser verification, new automated tests, lint, typecheck, or commit has
  been completed for this task.
- Review fixes: background polling no longer blocks guess clicks. A dedicated
  submission guard prevents duplicate requests, and a submission version discards
  polling responses that began before a new submission.
- Pending guess IDs remain tracked until their result is fetched, including when
  another tab resolves the guess and clears the profile's pending ID. Expired
  evidence is cleared when the profile confirms no pending guess. Result and
  refreshed score are applied together after successful reads.
- Replaced custom layout/typography CSS with Tailwind utilities. Plain CSS is
  limited to base styles, shared native button states, and keyboard focus.
- The user requested these fixes without Playwright work. Browser verification
  remains pending, so the task stays `in-progress`.
- The user subsequently requested a focused Playwright happy-path test; its scope
  and results are tracked in task 008. The first run exposed duplicate anonymous
  player creation during Strict Mode effect replay. Cancellation checks now stop
  discarded effects before they create a player or retry creation.
- Focused happy-path browser verification now passes: initial player/price/score,
  submission, pending controls, correct result, score +1, and persistence after
  reload. Error-state and broader desktop visual verification remain pending.
- Requested visual update: direction buttons use uppercase labels and green/red
  direction colors, retaining disabled behavior and a filled selected state.
  Updated existing Playwright locators to match the labels; no new tests added.
- Pending feedback uses sentence case; only UP/DOWN is uppercase and uses the
  direction's green/red color. Surrounding text and countdown remain neutral.
- Result price color applies only while displaying the resolved observation;
  a newer observation or different price returns it to black. Result feedback
  remains visible. Uses server result evidence without changing game rules.
- Requested readability refactor: extracted reusable native `DirectionButton`,
  `GuessControls` for status/actions, and `PriceDisplay` for observation/result
  presentation. Shared USD formatting lives in `currency.ts`; state, polling,
  and submission remain in `App.tsx`. Button CSS is scoped to direction buttons.
- Refactor validation: existing Playwright happy path passes (one test, 5.6
  seconds overall), and `git diff --check` passes. No new tests, lint,
  typecheck, formatter, or commit were run for the refactor.
- Further readability refactor: `App` composes `GameHeader`, `PriceDisplay`,
  `GuessControls`, and `GameHelp`. `useGame` owns coordinated game state and
  submission; `gameApi.ts` handles identity recovery and snapshot reads with
  explicit async/await. `usePrice` owns independent price polling. Countdown
  ticks are local to `GuessControls` via `useCountdown`, avoiding whole-screen
  updates every second. Added corresponding React structure rules to AGENTS.md.
- Hook/component refactor validation: the existing Chromium happy path passes
  (one test, 5.5 seconds overall), and `git diff --check` passes. `App.tsx` is now
  33 lines. No new tests, lint, typecheck, formatter, or commit were run.
- Moved the five extracted UI components into `src/components/` and updated
  direct imports. Added the component-directory convention to AGENTS.md.
- Moved the three hooks into `src/hooks/` and API/formatting helpers into
  `src/lib/`, updating direct imports and AGENTS.md. The entrypoints and stylesheet
  remain at the `src/` root; no barrel exports or further nesting were added.
- Simplified `useGame` control flow with named `applySnapshot`, `refreshGame`,
  and `applySubmittedGuess` operations. Its effect only owns polling setup,
  scheduling, and cleanup. Stable refresh callbacks prevent state updates from
  restarting polling. Added an explicit server snapshot type in `gameApi.ts`;
  submission guards and stale-response/cancellation handling remain in place.
- Hook simplification validation: existing Chromium happy path passes (one test,
  5.8 seconds overall), and `git diff --check` passes. No new tests, lint,
  typecheck, formatter, or commit were run.
- After UI approval, added the missing frontend/request coverage under task 007.
  All 91 unit/API tests and eight real DynamoDB integration tests pass. No commit
  has been made; remaining browser error-state/visual verification is still open.
- Review fixes: `.env.example` uses the same `127.0.0.1:5173` origin as the
  development command. `PriceDisplay` immediately renders newer resolution
  evidence instead of waiting for the price poll to match it, while preserving
  an already newer live observation. The next newer polled observation is black.
  Added origin-configuration and result/poll-timing regression tests.
- Review-fix validation: all 93 unit/API tests pass; the Playwright happy path
  passes in 5.5 seconds overall. `git diff --check` passes. No formatter, lint,
  typecheck, integration-suite rerun, or commit was performed for these fixes.
- Approved for commit. Pre-commit lint/typecheck found missing fetch-mock
  parameter types and one unused mock parameter; both are corrected. Whole-project
  lint and typecheck now pass. Lefthook runs staged lint, typecheck, all unit/API
  and local DynamoDB integration tests, and the production build during commit.
- Remaining desktop verification completed under task 008: higher/correct and
  lower/incorrect outcomes, equal-price pending, duplicate rejection, full Chromium
  restart while pending, keyboard focus, inline submission failure, and readable
  1440 × 900 layout. Both Playwright scenarios pass (13.5 seconds overall).
  Reviewed pending/result/error screenshots. Acceptance criteria are met; task is done.
