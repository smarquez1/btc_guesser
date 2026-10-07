# UI mockup

Create the main game screen in pen.dev before implementing the UI.
Read docs/ui.md and retain the .pen file in the repository.

## Acceptance criteria
- Show the score and latest available BTC/USD price in every game state.
- Use one screen for selection, submission, pending/countdown, and resolved results; do not add separate screens or routes for game states.
- Show loading, unavailable-price, and request errors inline on that screen.
- Retain 16:10 ready and success mockups of the same desktop screen. Mobile/tablet layouts are out of scope.
- Keep the design achievable with Tailwind and existing shadcn/ui primitives.

## Validation and limitations

- Retained ready and success mockups at 1440 × 900 (16:10) in `docs/ui.pen`. These illustrate states of one implemented screen, without additional routes.
- Success mockup shows the price in green, score increased to 1, explicit correct-guess feedback, and both direction buttons re-enabled for the next guess.
- Both mockups display the example player name Steve beside the score in the header.
- Keep both direction buttons visible in every state. While a guess is pending, disable both buttons and keep the selected direction highlighted. Re-enable both buttons after resolution so the user can choose their next guess directly; do not add a Try again screen or action. Display countdown, result, loading, and error text inline without replacing the controls.
- Used black, white, and neutral grays, square buttons, a large price, persistent header score, two direction buttons, and bottom help text explaining scoring and unchanged prices. Avoid decorative styling; green/red are reserved for resolved prices.
- Resolved price is green for a correct guess and red for an incorrect guess; explicit result text also communicates the outcome.
- Both buttons are neutral before selection. Highlight the selected direction with a black background and white label/icon while pending; keep the other button outlined.
- Inspected pen.dev screenshots and checked layout bounds; no clipping reported after adjustments.
- Prices, scores, and countdowns are illustrative. Browser implementation and Playwright verification belong to the game UI task.
