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
| Creation limit | `PLAYER_LIMIT#<SHA-256 of connection IP>` | `<UTC hour start>` | Atomically allow ten creation attempts per hour |
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

## Implemented player API

`POST /api/players` creates a server-generated UUID v4 identity, generated display
name, zero score, and epoch-second `createdAt`. The identity is a bearer secret
held only in an HTTP-only SameSite Strict cookie (`btc_player`, path `/api`,
one-year max age, Secure when configured). Responses exclude the identity.
An existing valid cookie reuses the profile; invalid cookies receive 401 and
are cleared. `GET /api/players/me` validates the cookie and reads the profile
consistently from DynamoDB, returning 401 for missing or unknown identities.
Creation accepts no state fields and checks supplied browser Origin against
`APP_ORIGIN`; explicit cross-site requests are rejected.

Creation limits use conditional DynamoDB updates, allowing ten attempts per
connection IP per fixed UTC hour across processes. Only a SHA-256 IP hash is
stored. Counter keys include the hour, so old records cannot block new windows
even before TTL cleanup. `expiresAt` is two hours after the window start; player
profiles have no TTL. A failed profile write can consume a limit attempt.
Forwarded headers are not trusted; proxy configuration belongs to deployment.
Cookie loss has no identity recovery. Clearing cookies can create additional
players within the creation limit, an accepted limitation of anonymous play.

## Implemented pricing API

`GET /api/price` exposes `{ symbol, price, observedAt, stale }` without requiring
an identity. Coinbase's public Exchange BTC-USD ticker provides the last-trade
price and source timestamp. The client validates a finite positive decimal price
and a valid nonfuture timestamp, converts it to epoch seconds, and uses a
five-second HTTP timeout. No secrets or additional configuration are required.

The price service checks `freshUntil` and `expiresAt` explicitly. Freshness lasts
five seconds from a successful fetch; retention lasts one hour from the source
observation. Fetching an unchanged ticker refreshes freshness without changing
`observedAt` or extending retention.
Fresh observations bypass Coinbase; stale/missing entries refresh on demand.
A failed fetch falls back to a consistent cache reread, allowing another process's
refresh to be used. Expired records are unavailable even before TTL deletion.
Old observations never receive new timestamps or extended retention on reads.
A conditional write orders observations by validated Coinbase `trade_id`, stored
as internal `tradeId`. Newer trades can replace older ones within the same epoch
second. Equal trades can advance `freshUntil`; older trades and earlier freshness
values cannot replace newer ones. Existing records without a trade ID can upgrade
only if the candidate observation timestamp is at least as recent. Trade IDs are
not returned by the API.

Available stale data returns 200 with `stale: true`; no available data returns
503 with a retry hint. Database errors propagate to the safe 500 handler. The API
sets `Cache-Control: no-store`. Task 005 must evaluate deadline eligibility from
`observedAt`, independently of `stale`; cached data from before a deadline cannot
resolve a guess simply because it was read afterward. No background jobs or
cross-process refresh locks are introduced; simultaneous cache misses may issue
multiple Coinbase requests, while conditional persistence preserves ordering.
