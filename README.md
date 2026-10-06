# BTC Guesser

A small web app for guessing whether BTC/USD will be higher or lower after at least one minute. This README is the project overview during planning; before submission, expand it with the finished app’s setup, test, deployment instructions, and live URL.

## Required game behavior

- Always show the player’s score and the latest available BTC/USD price. If the provider is unavailable, show the last known price as stale rather than implying it is current.
- Let the player choose **Up** or **Down**.
- Allow only one unresolved guess per player.
- Do not resolve a guess before 60 seconds have elapsed.
- At or after 60 seconds, compare the starting price with the first fresh price observation received by the backend. If the values differ, resolve the guess; if they are equal or data is unavailable, keep it pending.
- Award `+1` for a correct guess and `−1` for an incorrect guess. New players start at `0`.
- Persist player scores and guess state in a backend data store.

The price comparison uses the provider’s full-precision values. The interface may round prices for display. A move before the 60-second mark counts if the price is still different when checked after the minimum wait.

## Player identity

Each player has a backend record, created with score zero and associated with a server-issued session cookie. Ask for a display name, but use the cookie—not the name—to identify the player’s requests. A name is a label, not an account or password. Remembering the player after closing the browser is optional.

## Planned stack

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Tailwind CSS |
| Components | Standard shadcn/ui components |
| Backend | Fastify + TypeScript modular monolith |
| Persistent data | AWS DynamoDB |
| BTC/USD data | Coinbase Exchange public market data |
| Hosting | Render free web service; AWS for persistent data |
| Tests and checks | Vitest, React Testing Library, a small Playwright suite, Biome, Lefthook |
| Agent guidance | Project-local `typescript-fastify` and `typescript-testing` skills; see [AGENTS.md](AGENTS.md) |
| Mockup | Basic layout mockup in pen.dev; no custom visual theme |

## Delivery plan

1. Create a basic layout mockup and set up the app and developer workflow.
2. Implement player identity, DynamoDB persistence, price retrieval, and guess resolution.
3. Build the game interface and verify the core rules with focused tests.
4. Deploy the demo and document how to run and deploy it.

### Nice to have

- Keep the player’s score and active guess available after they close and reopen the browser.
- Add a small leaderboard.

Complete and deploy the core game before taking on these optional features. Keep the project within roughly half a day of work.

## Project docs

- [Product scope](docs/product-and-scope.md)
- [Technical approach](docs/technical-approach.md)
- [Milestones](docs/milestones.md)
- **Task tracking:** [numbered Markdown task descriptions](docs/tasks/README.md); no GitHub Issues.

## Submission checklist

- [ ] Public Git repository.
- [ ] Deployed solution and public URL.
- [ ] README updated with functionality, local setup, tests, deployment steps, assumptions, and deployed URL.
