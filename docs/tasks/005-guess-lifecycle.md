# Guess lifecycle

Depends on: 003, 004.
Read docs/backend.md. Implement submission and lazy/on-demand resolution.

## Acceptance criteria
- Backend validates direction and allows only one unresolved guess per player.
- Backend owns starting price, timestamps in epoch seconds, and the 60-second deadline.
- Only observations at or after the deadline can resolve a guess.
- Equal prices remain pending; correct guesses earn +1 and incorrect guesses lose 1.
- Persist result evidence and score changes atomically, preventing duplicate scoring
  and conflicting concurrent submissions.
- Shared rules determine consistent behavior across routes.

## Validation and limitations

Pending.
