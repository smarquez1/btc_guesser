# Project instructions

## Read before working

Read these sources before planning or implementing a task:

| Source | Responsibility |
|---|---|
| `docs/product-and-scope.md` | Game behavior, player identity, UX requirements, and scope boundaries |
| `docs/technical-approach.md` | Architecture, technology choices, and reliability tradeoffs |
| `docs/tasks/README.md` | Task order and current status; follow its linked prompt for the assigned task |

Keep product and architecture decisions in those documents, not in this file. If a task conflicts with them, clarify the conflict before implementing it.

## Working rules

- Keep changes focused on the assigned task and follow existing project conventions.
- Track work in `docs/tasks/`; update status after reviewing and verifying the work. Do not create GitHub Issues for project tracking.
- Prefer the smallest implementation that meets the documented requirements. Do not expand scope or add dependencies without a clear need.

## Implementation and verification

- Use the project-local `typescript-fastify` skill for Fastify work and `typescript-testing` for TypeScript/Vitest tests when relevant. These are guidance, not mandates: this file, the existing code, and current official docs take precedence. Do not add TypeBox, MSW, or other dependencies only because a skill demonstrates them.
- Use Biome for formatting/linting and Lefthook for fast local checks.
- Use Vitest for game rules and backend behavior, React Testing Library for UI behavior, and a small Playwright suite for the main browser journey.
- Make tests deterministic with injected time and price data. Do not depend on live Coinbase responses or wait a real minute in tests.
- Run the relevant checks for each change and report what ran and what passed.
- Do not mark tasks complete or claim deployment, a public repository, or final documentation exists without verifying it. Follow the deployment task for the final README requirements.
