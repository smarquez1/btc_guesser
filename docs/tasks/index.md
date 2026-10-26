# Task index

Statuses: todo, in-progress, blocked, done.
Update this index as work progresses; record validation and limitations in each task.

| Task | Status | Description |
| --- | --- | --- |
| 001 | done | [UI mockup](001-ui-mockup.md) |
| 002 | done | [Backend foundation](002-backend-foundation.md) |
| 003 | done | [Anonymous players](003-anonymous-players.md) |
| 004 | done | [BTC pricing](004-btc-pricing.md) |
| 005 | done | [Guess lifecycle](005-guess-lifecycle.md) |
| 006 | done | [Game UI](006-game-ui.md) |
| 007 | done | [Test coverage review](007-unit-tests.md) |
| 008 | done | [End-to-end verification](008-end-to-end-verification.md) |
| 009 | done | [Deployment](009-deployment.md) |
| 010 | done | [Expanded test coverage and parallel E2E](010-test-coverage-and-parallel-e2e.md) |
| 011 | done | [Rendering and asset foundation](011-rendering-and-assets.md) |
| 012 | done | [HTML session and game-state loading](012-html-game-state.md) |
| 013 | done | [HTML guess submission](013-html-guess-submission.md) |
| 014 | done | [HTMX game screen](014-htmx-screen.md) |
| 015 | done | [HTMX recovery and error behavior](015-htmx-recovery-and-errors.md) |
| 016 | done | [Server-view and HTML-route coverage](016-server-view-coverage.md) |
| 017 | done | [Browser migration and React removal](017-e2e-and-react-removal.md) |
| 018 | done | [Migration docs and delivery](018-docs-and-delivery.md) |

Testing strategy: Most automated coverage belongs in fast unit tests. Keep
end-to-end verification small and focused on the critical working flow.
Add and run unit tests when the developer asks, before committing related work.
Use focused integration tests where useful; defer end-to-end tests to task 008.

For tasks 011–018, the user authorized uninterrupted implementation and
verification. Do not pause for intermediate approval; hand back the completed
migration for user verification. Do not commit or deploy without a separate request.
