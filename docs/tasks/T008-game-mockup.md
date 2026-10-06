# T008 — Create the game mockup

**Goal:** Create a basic game layout mockup in pen.dev.

**Dependencies:** [Product scope](../product-and-scope.md) and
[technical approach](../technical-approach.md); this is the layout reference for
[T005 — Interface](T005-game-interface.md), not a runtime implementation prerequisite.

**Mockup:** [../mockup.pen](../mockup.pen)

**Status:** Done — user-confirmed completion; no fresh visual verification performed.

## Historical scope

- Create a basic main-screen desktop layout in pen.dev with readable BTC price,
  score, and Up/Down controls.
- Establish the main information/control grouping as a reference for standard
  shadcn/ui components and Tailwind implementation, not a bespoke visual theme.

## Handoff

- T005 inspects the linked mockup through pen.dev tools when implementing the UI;
  the `.pen` file is not a text document to read or edit directly.
- T005 owns responsive/mobile behavior, onboarding, pending/result, loading,
  stale/unavailable, error, and accessible interaction states. This completed
  ticket does not claim that those screens or behaviors were designed here.

**Out of scope:** Mobile mockups, remaining game-state mockups, UI code, and
bespoke theming. Do not reopen or expand this deliverable as part of ticket editing.

## Acceptance record

- [x] Basic desktop game layout is ready to guide implementation, as confirmed
  by the user.
- [x] Mockup reference and T005 ownership are recorded.

## Verification to report

- Historical evidence is user-confirmed completion only. This documentation update
  does not represent a fresh pen.dev inspection or visual verification.
- Any later visual inspection belongs to T005's implementation report; preserve
  this task's completed status and original scope.
