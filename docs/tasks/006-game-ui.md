# Game UI

Depends on: 001, 005.
Read docs/ui.md and inspect the retained .pen mockup before implementation.

## Acceptance criteria
- Implement the mockup with React, Tailwind, and existing shadcn/ui primitives.
- Use a single desktop screen based on the 16:10 mockup with inline state changes; do not create extra screens or routes for pending, results, loading, or errors.
- Keep both direction buttons visible. Disable both while pending, highlight the selected direction, and re-enable them after resolution. Start the next guess directly from those buttons; no Try again screen or action.
- Always display score and latest available BTC/USD price.
- Support anonymous identity, guess submission, pending state, results, and errors.
- Render server state; countdowns are presentation only.
- Prevent duplicate submissions in the UI and handle backend rejection clearly.
- Verify meaningful UI changes with Playwright on desktop. Mobile/tablet layouts and verification are out of scope.

## Validation and limitations

Pending.
