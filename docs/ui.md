# UI guidance

## Implementation

Keep the UI minimal, polished, and responsive.

Use:

- React
- TypeScript
- Vite
- Tailwind
- shadcn/ui

Prefer existing shadcn primitives over custom UI infrastructure.

Use local React state unless something more complex is clearly required.

Avoid:

- Redux
- Zustand
- unnecessary context providers
- excessive custom hooks
- custom design systems
- frontend business logic

Do not build abstractions merely because the project may grow later.

## Design workflow

Use pen.dev to create or update mockups before implementing major screens. Keep the `.pen` design file in the repository and inspect it before implementing meaningful UI changes. Treat it as the visual reference, not generated code that must be copied literally. Implement with existing shadcn/ui primitives and Tailwind whenever possible. Do not create custom components when a shadcn primitive is sufficient. Keep the UI focused on the core game flow. Always display the score and latest available BTC/USD price.

## Browser verification

After implementation, verify the rendered UI with Playwright. For meaningful game-flow changes, check:

- Initial load and BTC price display
- Anonymous player creation
- Guess submission
- Pending/countdown state
- Resolved result and score
- An obvious error state
- Responsive layout

Use browser automation for verification without adding test infrastructure. Avoid repeating the full flow for trivial changes.
