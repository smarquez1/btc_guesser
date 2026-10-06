# Milestones

Track work in the [task index](tasks/README.md). Each numbered task file is a self-contained prompt with its goal, scope, dependencies, and completion checks.

## 1. Project foundation

Set up the React/Fastify TypeScript app, create a basic pen.dev mockup, add the standard component library, and establish the local development workflow and GitHub checks.

**Complete when:** the app runs locally and the main responsive screen direction is established.

## 2. Persistent game flow

Connect DynamoDB, player profiles and sessions, Coinbase price data, and the guess/score rules.

**Complete when:** a player can submit one guess, see it resolved according to the rules, and the score is persisted in DynamoDB.

## 3. Verification and polish

Add focused unit and integration tests, frontend interaction tests, and a small number of Playwright journeys. Refine the interface and handle provider and loading states.

**Complete when:** the main user journey and important game rules are covered without relying on live market data in tests.

## 4. Deploy and document

Deploy the public demo, verify the hosted flow, and write the project README with setup, testing, deployment, assumptions, and the live link.

**Complete when:** a reviewer can open the demo and understand how to run and deploy the project.

## Nice to have

- Remember a player after closing and reopening the browser.
- Add a small leaderboard of display names and scores.

Start these only after the core game is deployed and verified.
