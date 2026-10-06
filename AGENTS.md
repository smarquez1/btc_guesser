# Project instructions

## Read before working

Read these sources before planning or implementing a task:

| Source | Responsibility |
|---|---|
| `docs/product-and-scope.md` | Game behavior, player identity, UX requirements, and scope boundaries |
| `docs/technical-approach.md` | Architecture, technology choices, and reliability tradeoffs |
| `docs/tasks/README.md` | Task order and current status; follow its linked prompt for the assigned task |
| `docs/mockup.pen` | Game interface design reference; inspect with pen.dev tools when working on the UI |

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

## Developer workflow

- Use Node.js 24 and pnpm only. Keep `packageManager` pinned to `pnpm@12.9.1`; commit `pnpm-lock.yaml`, not npm or Yarn lockfiles.
- Install the recorded dependencies with `pnpm install --frozen-lockfile`. When intentionally changing dependencies, update the pnpm lockfile and keep build-script approvals narrowly scoped.
- Start both development servers with `pnpm dev`; see README for separate-server commands and port overrides.
- Keep the development API on port 3000: Vite's `/api` proxy is fixed to `http://127.0.0.1:3000`. `PORT`/`HOST` still configure Fastify, including production runs.
- Pre-commit runs Biome safe fixes (`check --write`, no `--unsafe`) and re-stages them before project type checks. Lefthook preserves unstaged edits in partially staged files; unresolved TypeScript errors block the hook and need manual correction.
- Run `pnpm check` (Biome, TypeScript, Vitest) and `pnpm build` for setup or integration changes. Report their actual results before marking work complete.
- Diagnose TypeScript errors with `pnpm typecheck` and formatting/lint issues with `pnpm lint`. Fix the underlying cause rather than weakening strict mode or adding blanket suppressions; add lint rules only for demonstrated problems. When adding maintained source or tooling files, keep Biome's `files.includes` coverage current.
