# Backend guidance

## Structure and ownership

Keep files focused and create folders only when needed:

- `server/routes/`: HTTP handling and status codes.
- `server/services/`: business rules and orchestration.
- `server/repositories/`: explicit DynamoDB reads and writes.
- `server/schemas/`: request/response validation.
- `server/lib/`: small infrastructure helpers and external clients.
- `server/types/`: genuinely shared domain types.

Separate Fastify app construction and route registration from process startup
when useful. Preserve working entrypoints rather than renaming them to fit a
template. Keep I/O separate from business rules where practical, reuse shared
rules across routes, and avoid extra architectural layers.

The backend owns identity validation, game rules, prices, timestamps, caching,
deadlines, resolution, and persistence. The frontend renders server state,
collects input, calls APIs, and displays countdowns. Never trust client-provided
prices, timestamps, deadlines, results, scores, or player state.

## Anonymous players

The backend generates an anonymous identifier, which the frontend retains for
later requests. Validate player identity on the backend. Add cheap rate limiting
for player creation and TTL/cleanup for ephemeral records. Full authentication
is out of scope unless explicitly required.

## Prices and caching

Use integer Unix epoch seconds for all backend timestamps, including `observedAt`,
guess times, deadlines, and TTL. Convert to milliseconds only for JavaScript
dates or timers.

Fetch BTC/USD from Coinbase through a small backend service. Normalize each
observation to `{ price: number, observedAt: number }`; `observedAt` is when the
price was observed, not when it was returned to the client.

Use DynamoDB as the shared cache, storing at least `symbol`, `price`,
`observedAt`, and `expiresAt`, with appropriate TTL. Keep cache freshness,
observation time, and resolution eligibility separate. Reads must preserve
`observedAt`: an observation from before a deadline stays ineligible even when
read after that deadline. Avoid Redis or ElastiCache without a concrete need.

## Game rules and resolution

- Players start at zero and may have only one unresolved guess.
- The backend sets the starting price, start time, and 60-second deadline.
- Resolve only with an observation at or after the deadline whose price differs
  from the starting price. Equal prices remain pending.
- Correct guesses earn +1; incorrect guesses lose 1. Persist scores in DynamoDB.
- Store enough evidence to explain each result deterministically.
- Enforce one pending guess atomically. Persist the resolved result and score
  change together exactly once, including under concurrent requests or retries.

Prefer lazy resolution: submit and store the guess, then resolve on a later
fetch when an eligible observation exists. Background queues, schedules, and
workers are unnecessary unless a concrete requirement emerges.

## API and persistence

Keep the API small and explicit. A suggested shape is:

```text
POST /api/players
GET  /api/price
POST /api/guesses
GET  /api/guesses/:id
```

Validate all input server-side, using Fastify schemas where practical. Return
sensible status codes and explicitly handle invalid players/guesses, missing
or stale prices, Coinbase unavailability, pending results, and DynamoDB failures.
Do not expose internal error details.

Use straightforward DynamoDB keys and understandable records based on required
access patterns. Avoid elaborate single-table designs without justification.
Keep database access in repositories and use TTL for ephemeral data.
TTL deletion is asynchronous: check expiry explicitly rather than relying on
records disappearing. Cleanup expiry and cache freshness remain separate concerns.


## Storage model

One table uses string keys `pk` and `sk`; no secondary indexes are needed for
current access patterns:

| Record | pk | sk | Access |
| --- | --- | --- | --- |
| Player | `PLAYER#<id>` | `PROFILE` | Validate identity; read score and pending guess ID |
| Guess | `GUESS#<id>` | `DETAILS` | Read pending state or saved result by ID |
| Price cache | `PRICE#BTC-USD` | `LATEST` | Read/update the shared observation |

Players retain their score and have no TTL. Ephemeral records use `expiresAt`
in epoch seconds. Cache freshness uses a separate `freshUntil` timestamp;
`expiresAt` controls cleanup. Do not expire pending guesses independently of
players: TTL must not leave a player pointing at a deleted unresolved guess.
Choose retention for resolved guesses and other ephemeral records in their tasks.

Task 005 will use a conditional transaction to create a guess and set the
player's pending guess ID only if none exists. Resolution will conditionally
save the result, increment the player's score, and clear that pending ID in
one transaction. This supports direct lookups, prevents conflicting submissions,
and makes retries safe without locks or background workers.

`pnpm db:create` creates this table with on-demand billing and enables
`expiresAt` TTL. It checks existing keys and TTL configuration on reruns.
DynamoDB Local accepts TTL configuration but does not perform automatic TTL
deletion; explicit expiry checks are still required.
