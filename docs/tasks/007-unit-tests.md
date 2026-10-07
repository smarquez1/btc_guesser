# Unit tests

Depends on: 005, 006.
Most automated coverage should be fast, deterministic unit tests. Keep setup small;
isolate time, Coinbase, and DynamoDB I/O without introducing architectural layers.
This task precedes end-to-end verification.

## Acceptance criteria
- Cover the 60-second boundary, pre-deadline observations, and equal-price pending.
- Cover both directions, correct/incorrect scoring, and initial score zero.
- Cover preserved cached observedAt and freshness versus resolution eligibility.
- Cover invalid inputs/identity, one-pending-guess enforcement, and repeat resolution.
- Exercise concurrency safeguards where practical; identify anything requiring
  integration verification rather than claiming unit tests prove DynamoDB behavior.
- Cover meaningful UI state behavior where it adds value.
- Document and run the unit-test command; avoid real network calls and timed waits.

## Validation and limitations

Pending.
