# End-to-end verification

Depends on: 007.
Keep browser verification limited because end-to-end runs are slow. Unit tests own
the rule permutations; verify the critical integrated flow directly with Playwright.

## Acceptance criteria
- Verify initial load, player creation, BTC price, and score.
- Submit a guess, observe pending state, then verify result and persisted score.
- Verify reload persistence, one clear error state, and the desktop layout. Mobile/tablet verification is out of scope.
- Record evidence and limitations; do not duplicate the unit-test matrix in browsers.
- Avoid a broad end-to-end suite or CI setup unless separately requested.

## Validation and limitations

Pending.
