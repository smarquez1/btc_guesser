# Rendering and asset foundation

Depends on: none.

This was the first migration milestone: establish Fastify template rendering,
form parsing, and a local Vite/Tailwind asset pipeline. The temporary foundation
page and React coexistence described in the original plan were superseded by the
completed HTMX migration in tasks 012–018.

## Acceptance criteria and results

- Added Fastify EJS rendering with automatic escaping and URL-encoded form parsing.
- Kept Vite and Tailwind as the asset pipeline; production HTML reads CSS and
  JavaScript paths from the Vite manifest, while development uses Vite-hosted
  assets.
- Replaced the temporary foundation page with the final server-rendered game at
  `/api/game`; `/` redirects there. Production startup requires the manifest and
  checks all referenced assets. Static files are served from `dist/assets`.
- `mise exec -- pnpm build` and the complete production browser scenario pass.
- Task complete. React and the temporary rendering endpoint were removed in the
  later migration tasks. No commit made.
