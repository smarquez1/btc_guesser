# HTMX game screen

Depends on: 013.

## Scope and acceptance criteria

- Inspect the retained UI mockup and replace the temporary foundation page with
  the existing single-screen game experience rendered by Fastify templates.
- Use HTMX for session loading, fragment polling, and form submission.
- Use one stable request-coordination owner outside the replaceable game fragment.
- Keep the player name, score, latest BTC/USD price, both direction buttons,
  pending feedback, countdown, result, loading, and errors in the same screen.
- Preserve desktop layout, native semantics, visible focus, and current colors.
- Use browser JavaScript only for presentation behavior such as the countdown.
  The backend remains authoritative for all game decisions.
- Keep Vite/Tailwind for local first-party assets; no CDN dependency.

## Validation plan

- After implementation approval and an explicit test request, verify initial page
  loading, the two directions, pending presentation, results, and another round.
- Verify the build scans server templates for Tailwind classes.

## Implementation progress

- Added the main Fastify game page at `/api/game`; `/` redirects there so the
  existing `/api` cookie is naturally sent without changing its scope.
- Replaced the temporary foundation view with the HTMX game template. A stable
  synchronization root wraps the replaceable game fragment; polling uses a
  no-queue cadence and submissions drop duplicates.
- Added the bundled HTMX 2.0 browser entry, local Vite development assets, and
  manifest-backed production assets. The server-rendered page now uses the
  development origin `127.0.0.1:3000`; Vite serves assets on `5173`.
- `mise exec -- pnpm build` passes. A real production server returns the page
  with manifest-generated JS/CSS, and `/` redirects to `/api/game`.
- Browser verification is recorded in task 017; task complete.
