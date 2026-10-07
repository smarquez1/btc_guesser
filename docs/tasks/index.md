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
| 006 | todo | [Game UI](006-game-ui.md) |
| 007 | todo | [Test coverage review](007-unit-tests.md) |
| 008 | todo | [End-to-end verification](008-end-to-end-verification.md) |
| 009 | todo | [Deployment](009-deployment.md) |

Testing strategy: Most automated coverage belongs in fast unit tests. Keep
end-to-end verification small and focused on the critical working flow.
Add and run unit tests when the developer asks, before committing related work.
Use focused integration tests where useful; defer end-to-end tests to task 008.
