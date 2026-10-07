# UI guidance

## Implementation

Keep the UI minimal and readable for desktop only. Use the approved 16:10 mockup as a loose guide for layout and game states. Exact visual matching is unnecessary; prioritize simple semantic HTML and minimal styling. Mobile/tablet layouts and verification are out of scope for this challenge.

Use:

- React
- TypeScript
- Vite
- Semantic native HTML, including native buttons
- Tailwind CSS, retaining the existing Vite plugin and CSS import
- Small amounts of plain CSS when useful

Use native controls and browser behavior. Do not use shadcn/ui, Base UI, or another UI component library. Keep Tailwind utilities and plain CSS focused on layout, spacing, readability, visible keyboard focus, and selected/disabled/result states. Avoid unnecessary wrappers, utility classes, and custom styles. Do not build a custom component system or add decorative styling.

Use local React state unless something more complex is clearly required.

Use uppercase direction labels: green `GUESS HIGHER` and red `GUESS LOWER`.
While pending, fill the selected button with its direction color and use white
text; keep the other outlined. Both remain disabled until resolution. Resolved
price feedback uses green for correct and red for incorrect while displaying the
result's price observation, then returns to black on a newer observation or a
different price. Keep the result message visible.
Pending feedback uses sentence case. Only UP/DOWN is uppercase and colored:
green for UP, red for DOWN. Keep surrounding text and countdown neutral.

Avoid:

- Redux
- Zustand
- unnecessary context providers
- excessive custom hooks
- custom design systems
- frontend business logic

Do not build abstractions merely because the project may grow later.

## Design workflow

Use pen.dev to create or update mockups before implementing major screens. Keep the `.pen` design file in the repository and inspect it before implementing meaningful UI changes. The existing mockup is sufficient for task 006; no redesign is required. Preserve its single-screen flow and game states with semantic HTML and minimal Tailwind styling. Simplify visual details when that reduces markup or CSS. Always display the score and latest available BTC/USD price.

## Browser verification

After implementation, verify the rendered UI with Playwright. For meaningful game-flow changes, check:

- Initial load and BTC price display
- Anonymous player creation
- Guess submission
- Pending/countdown state
- Resolved result and score
- An obvious error state
- Readable desktop layout at 16:10, without requiring an exact mockup match

Use browser automation for direct verification without adding an end-to-end suite. The user has authorized installing Playwright if needed. Record which checks use real APIs and which use controlled responses; final integrated verification belongs to task 008. Avoid repeating the full flow for trivial changes.
