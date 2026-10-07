# Backend guidance

## Backend Structure

Use a predictable backend layout:

```text
server/
  routes/
  services/
  repositories/
  schemas/
  lib/
  types/
```

Create folders only when needed. Keep application construction and process startup separate when useful; do not reorganize working entrypoints just to match a template.

Responsibilities:

- `routes/`: HTTP concerns only.
- `services/`: business logic and application rules.
- `repositories/`: DynamoDB access.
- `schemas/`: request/response validation.
- `lib/`: small shared infrastructure helpers and external clients.
- `types/`: genuinely shared domain types.
- `app.ts`: Fastify app construction and route registration.
- `server.ts`: process startup only.

Guidelines:

- Keep files focused and reasonably small.
- Avoid giant route handlers.
- Avoid giant utility files.
- Avoid arbitrary folder proliferation.
- Routes should not contain business logic.
- Routes should not contain direct DynamoDB access when that logic belongs in a repository.
- Reuse shared game rules instead of duplicating them across routes.
- Keep I/O separate from business logic where practical.
- Do not introduce extra layers beyond route/service/repository unless there is a concrete reason.

Avoid architectures like:

```text
Controller
→ Handler
→ UseCase
→ Manager
→ Service
→ Repository
→ Adapter
```

for simple operations.

## Frontend / Backend Boundary

The backend is authoritative for:

- player/session validity
- game rules
- guess validation
- BTC price observations
- observation timestamps
- price freshness
- caching
- deadlines
- result resolution
- persistence

The frontend may:

- render backend state
- collect user input
- call APIs
- display countdowns
- manage presentation-only state

Do not duplicate authoritative game logic in React.

Never trust client-provided:

- timestamps
- deadlines
- prices
- game results
- player state
- win/loss decisions

## Player Identity

Do not build full authentication unless explicitly required.

Use anonymous players.

A typical flow may be:

```text
first visit
→ create anonymous player
→ backend generates UUID
→ frontend stores player/session identifier locally
→ later requests reuse that identity
```

The backend must still validate player-related requests.

Use proportionate abuse protection for player creation:

- cheap rate limiting or throttling
- TTL/cleanup for ephemeral records

Do not add:

- OAuth
- passwords
- account recovery
- Cognito flows
- full identity management

unless required by the assignment.

## Coinbase Integration

Coinbase is the source for BTC/USD prices.

Keep Coinbase access behind a small backend service.

Normalize observations into a structure like:

```ts
type PriceObservation = {
  price: number;
  observedAt: number;
};
```

The timestamp matters.

Do not confuse:

```text
time the backend returned a price
```

with:

```text
time the price was actually observed
```

## Price Caching

Caching is required.

Prefer DynamoDB as the shared cache.

Do not add Redis or ElastiCache unless there is a compelling requirement.

A cached observation should preserve at least:

```ts
{
  symbol: "BTC-USD",
  price: number,
  observedAt: number,
  expiresAt: number
}
```

Use TTL where appropriate.

Important rule:

> A cached observation keeps its original `observedAt`.

Reading it later must never make it appear newer.

Keep these concepts separate:

- cache freshness
- observation timestamp
- game-resolution eligibility

A price observed before a deadline remains a pre-deadline observation even if it is returned from cache after the deadline.

## Game Resolution

Resolve guesses only on the backend.

The backend decides:

- whether the guess is valid
- when the deadline occurs
- which price observation is eligible
- whether the result is pending
- whether the player won or lost

Prefer lazy/on-demand resolution over background infrastructure.

A simple flow is preferred:

```text
submit guess
→ store guess and deadline
→ frontend polls/fetches later
→ backend resolves when eligible
```

Do not add:

- queues
- cron jobs
- scheduled workers
- event buses
- distributed workflows

unless they are genuinely required.

Store enough state to explain a resolved result deterministically.

## API Style

Keep the API small and explicit.

A reasonable shape may be:

```text
POST /api/players
GET  /api/price
POST /api/guesses
GET  /api/guesses/:id
```

Adapt only if the assignment requires it.

Validate all API input server-side.

Use Fastify schemas where practical.

Return sensible HTTP status codes.

Handle expected failures explicitly:

- invalid player
- invalid guess
- missing or stale price
- Coinbase unavailable
- result not ready
- DynamoDB failure

Do not leak internal error details to the client.

## DynamoDB

Keep the data model simple.

Do not build an elaborate single-table design unless the access patterns clearly justify it.

Prefer straightforward keys and understandable records.

Use TTL for ephemeral data where appropriate.

Use repositories for DynamoDB reads and writes.

Do not mix DynamoDB concerns into route handlers.

## Game invariants

Players start at zero and may have only one unresolved guess. Resolve only using an observation at least 60 seconds after the guess starts and with a price different from the starting price. Equal prices remain pending. Correct guesses earn +1; incorrect guesses lose 1. Persist scores in DynamoDB and store enough state to explain every result deterministically. Reuse these rules across routes.
