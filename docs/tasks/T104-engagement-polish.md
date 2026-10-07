# T104 — Add engagement polish to the game interface

**Goal:** Make the existing game loop feel more engaging through presentation-only
enhancements, without changing any game rule.

**Status:** Ready (nice to have). Do not start while
[T005 — Game interface](T005-game-interface.md) is in progress or has uncommitted
work, to avoid a competing writer on the same components.

**Dependency:** [T005 — Build the game interface](T005-game-interface.md). Start
only after T005's state/interaction work is settled. Consume its components,
game hook, and copy module rather than introducing a parallel UI.

Follow [product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md).

## Hard constraints — no rule changes

- Scoring stays +1/−1, one active guess at a time, and the 60-second minimum is
  measured per guess from its own acceptance time.
- Resolution stays: first fresh observation received at/after the deadline whose
  value differs from that guess's recorded starting price. No global rounds,
  shared opening price, streaks, point multipliers, confidence bets, or
  crowd-based scoring.
- The countdown remains a display aid. Zero means checking/waiting for the server,
  never automatic resolution, and it can never change the score.
- The client must not compare prices (including displayed/rounded values) to infer
  an outcome. Results and score deltas come only from authoritative server state.
- Any celebration reflects only a server-confirmed result; never compute or assume
  a win locally.

## In scope

1. **Wait as anticipation.** In `PendingGuess`, render the wait as a progress
   ring/bar bound to the server-provided acceptance/deadline fields, with honest
   "still waiting for a different price" wording. Keep beyond-deadline messaging
   accurate: 60 seconds is a minimum and an unchanged or unavailable price keeps
   the guess pending.
2. **Resolution reveal.** In `LatestResult`, animate the server-confirmed result
   and score delta so the payoff moment lands, with a reduced-motion fallback.
3. **Confetti on a won guess.** Celebrate a *newly* server-confirmed winning
   result once. It must not fire on initial hydration, reload, or replay of a
   previously seen result. Respect `prefers-reduced-motion` and degrade gracefully
   if effects are unavailable.
4. **Keep going.** After a result, give a clear call-to-action/focus to submit the
   next guess. It must still allow only one active guess.
5. **Warmer copy.** Improve waiting/error wording in `Notice` and related
   states, centralizing any new strings in `copy.ts`. Do not overpromise a
   resolution time.
6. **Keyboard guessing.** Allow ArrowUp / ArrowDown to submit an Up/Down guess
   through the same single-guess path as the buttons. Trigger only when a guess is
   currently allowed (valid session, no active guess, no request in flight), and
   suppress the shortcut while focus is in a text input (for example the
   display-name field) or combined with modifier keys. Keep the buttons and an
   on-screen shortcut hint so the keyboard path is discoverable and never the only
   way to play; do not let it hijack page scrolling in a way that traps the user.
7. **Stacked notifications.** Let result/action notifications accumulate as a
   short, bounded queue with a tasteful enter/exit animation, instead of replacing
   each other in place. Keep the queue bounded (drop the oldest at the cap), keep
   the newest item visible, and provide a reduced-motion fallback. Announce only
   the meaningful transitions, never every item or animation frame.

## Telemetry — add none

- The client has no diagnostics/telemetry layer by design. Add no telemetry, no
  observability dependency, and no logging on animation frames, countdown ticks,
  or price polls. Never log names, cookies, credentials, or personal data.

## Contracts and handoffs

- **T005:** Consume its components, game hook, and server field names; this
  task is presentation-only and changes no backend contract, endpoint, or payload.
- **Accessibility:** Preserve keyboard focus, labels, contrast, and restrained
  status announcements. Do not announce every tick or animation.
- **Dependencies:** Prefer a minimal or dependency-free celebration/effect
  approach. If a library is added, justify it in the owning docs and keep it
  narrowly scoped.

**Out of scope:** Any game-rule change, global rounds, leaderboard, accounts,
guess history, persistent return visits, market streaming, bespoke theming,
backend or persistence changes, and reopening T008. Price movement color is owned
by T005, not this task.

## Acceptance criteria

- [ ] The countdown reads only from server fields, cannot resolve a guess, and
  cannot change the score; beyond-deadline pending states stay accurate.
- [ ] Reveal and confetti fire only for a newly server-confirmed result — never on
  load, reload, or replay — and respect reduced-motion.
- [ ] The next-guess call-to-action does not permit a second active guess or
  duplicate submission.
- [ ] Arrow-key guessing follows the same guards as the buttons (no active guess,
  valid session, no in-flight request), is ignored while typing in inputs, keeps
  the buttons as the discoverable primary control, and does not trap scrolling.
- [ ] Notifications stack in a bounded queue with a reduced-motion-safe
  animation, keep the newest visible, and do not announce every item.
- [ ] No game rule, backend contract, or T005 behavior is changed.

## Verification to report

- Deterministic React Testing Library tests: countdown display from server fields,
  reveal on a confirmed result, no celebration on hydration/reload/replay,
  reduced-motion behavior, no duplicate submission, and ArrowUp/ArrowDown
  submission including the blocked-when-ineligible and ignored-while-typing cases.
- Actual `pnpm check` and `pnpm build` results.
- Manual desktop and mobile checks, including `prefers-reduced-motion`, keyboard
  focus, and live-update noise.
