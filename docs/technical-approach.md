# Technical approach

## Architecture

```text
React app ──> Fastify API ──> DynamoDB
                   │
                   └──> Coinbase BTC-USD market data
```

Deploy the React build and Fastify API together as one small application. Keep game rules separate from HTTP routes so the background resolution work can be moved to AWS Lambda later if the app needs more reliable independent processing.

## Choices

| Area | Plan |
|---|---|
| Frontend | React + TypeScript + Tailwind CSS |
| Components | Standard shadcn/ui components; Tailwind is used for layout |
| Backend | Fastify + TypeScript modular monolith |
| Persistence | AWS DynamoDB |
| Price provider | Coinbase Exchange BTC-USD public endpoint |
| Hosting | Render free web service |
| Price caching | Small shared in-process cache; no separate cache service initially |
| Player identification | Display name plus backend player ID and browser-session cookie; persistent return visits are optional |
| Project tracking | Plain-text task index and numbered prompts in `docs/tasks/` |
| Agent skills | Project-local Fastify and TypeScript testing guidance |

## Fairness and reliability

The server records the starting price and acceptance time. A guess cannot resolve before 60 seconds have elapsed. At or after the deadline, resolve using the first fresh Coinbase observation that differs from the starting price. The observation must be received after the deadline; its exchange trade timestamp is useful context but is not an extra eligibility condition. This means a price move before the deadline counts if it remains different when observed after the deadline. An unchanged price or provider failure leaves the guess pending. Database updates must prevent overlapping guesses and duplicate score changes.

Price data is polled and cached briefly by the backend so browser traffic does not create a separate provider request each time. This is sampled market data, not a guarantee of observing every trade.

## Tradeoffs to explain

- Render’s free service may sleep when idle, delaying background resolution until it wakes. Guess state remains in DynamoDB.
- Anonymous progress is tied to the browser cookie; losing it means losing access to that player.
- If independent background processing becomes important, move the resolution job to Lambda while keeping the API and game rules in the same codebase.
- Free-tier limits and eligibility can change; check AWS usage and configure a budget alert.
