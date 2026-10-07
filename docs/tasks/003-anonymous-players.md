# Anonymous players

Depends on: 002.
Read docs/backend.md. Implement anonymous player creation and identity validation.

## Acceptance criteria
- New players start with a score of zero persisted in DynamoDB.
- Returning players can reuse a backend-validated identity.
- Invalid identities receive explicit, safe errors.
- Player creation has cheap rate limiting; ephemeral records use TTL.
- Client-provided scores and player state are never authoritative.

## Validation and limitations

Pending.
