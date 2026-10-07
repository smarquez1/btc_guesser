# BTC pricing

Depends on: 002.
Read docs/backend.md. Fetch Coinbase BTC/USD observations and cache in DynamoDB.

## Acceptance criteria
- API exposes the latest available price and its observation timestamp.
- Cache reads preserve observedAt; freshness and resolution eligibility are separate.
- Cache records have an explicit expiry and appropriate TTL.
- Missing/stale observations and Coinbase failures have explicit behavior.
- Coinbase I/O stays separate from pricing rules.

## Validation and limitations

Pending.
