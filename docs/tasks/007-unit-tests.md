# Test coverage review

Depends on: 005, 006.
Most automated coverage should be fast, deterministic unit tests. Keep setup small;
isolate time, Coinbase, and DynamoDB I/O without introducing architectural layers.
Add unit tests when requested during implementation, before related commits.
This task reviews accumulated coverage and fills critical gaps before end-to-end
verification; it does not gate earlier unit or integration tests.

## Acceptance criteria
- Cover the 60-second boundary, pre-deadline observations, and equal-price pending.
- Cover both directions, correct/incorrect scoring, and initial score zero.
- Cover preserved cached observedAt and freshness versus resolution eligibility.
- Cover expiry checks while expired records still exist awaiting TTL cleanup.
- Cover invalid inputs/identity, one-pending-guess enforcement, and repeat resolution.
- Exercise concurrency safeguards where practical; identify anything requiring
  integration verification rather than claiming unit tests prove DynamoDB behavior.
- Cover meaningful UI state behavior where it adds value.
- Document and run the unit-test command; avoid real network calls and timed waits.

## Validation and limitations

Foundation coverage was added with task 002: configuration unit tests, Fastify
injection integration tests, and optional local DynamoDB integration tests.
Commands and validation are recorded in README and task 002. Game and UI coverage
remain pending until those features exist; this task remains todo.
