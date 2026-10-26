# Allow both local development origins

Depends on: 002, 003, 011.

## Scope and acceptance criteria

- Allow local development at both `http://localhost:5173` and
  `http://127.0.0.1:5173`, regardless of which one is configured as
  `APP_ORIGIN`.
- Keep production origin validation exact.
- Verify origin policy and the browser flow; leave deployment unchanged.

## Validation and limitations

- Unit coverage verifies both loopback aliases, rejects a different port or
  protocol, and keeps production origin validation exact.
- A route test verifies player creation from the `localhost` alias.
- E2E coverage opens the application through `localhost`, creates the player,
  submits a guess, and keeps the production entrypoint scenarios passing.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test`: pass (84 unit/API tests).
- `pnpm test:integration`: all 11 tests pass against DynamoDB Local.
- `pnpm test:e2e`: all 11 scenarios pass, including the localhost browser flow.
- `git diff --check`: passes. No formatter was run.
