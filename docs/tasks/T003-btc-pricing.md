# T003 — Integrate BTC pricing and caching

**Goal:** Provide validated, current BTC/USD observations from Coinbase Exchange.

**Scope:** Implement the BTC-USD public ticker adapter, validate and retain the provider’s full-precision price and timestamps, and add a short-lived in-process cache so browser requests share provider calls. Surface stale/unavailable state instead of treating old data as current.

**Dependencies:** T001.

**Done when:** Valid, malformed, stale, and failed provider responses are handled; callers share a cached/in-flight observation; price tests use deterministic responses, not live Coinbase data.
