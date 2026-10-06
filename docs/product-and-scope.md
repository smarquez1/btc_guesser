# Product scope

## The game

Players see the latest available BTC/USD price and their score. They choose **Up** or **Down**, then wait until at least 60 seconds have passed and a fresh price observation differs from the starting price. A correct guess earns one point; an incorrect guess loses one point. Players can have only one active guess at a time, and new players start at zero.

The backend selects and records price observations. If the price has not changed, or valid price data is unavailable, the guess remains pending. The interface should explain this clearly.

The 60-second wait is a minimum. At or after that deadline, compare the latest fresh observation with the starting price: resolve if they differ; otherwise keep waiting. A price move that happened before the deadline still counts if the price remains different when checked after the deadline. Use the server’s observation-received time for this deadline check; retain the provider’s trade timestamp as market-data context, not as an additional timing requirement.

Compare the provider’s full-precision values; display rounding must not affect the result. If the provider is unavailable, keep showing the last known price with a stale/unavailable indication, and do not use it to resolve a guess.

## Core experience

- Show the current price and score throughout play.
- Make it easy to submit and understand a guess.
- Show the pending state, result, and score change.
- Keep the player’s score and active guess available during the current browser session.
- Present a readable, responsive interface with clear loading and error states.

Each player has a display name and a backend-generated player ID. The name is a label, not a login credential; a session cookie identifies the player’s requests. Remembering the player after closing the browser is optional; password-based accounts and cross-device recovery are out of scope.

## Interface

Create a basic layout mockup in pen.dev, then use standard shadcn/ui components and Tailwind for a clear, responsive implementation. Prioritize readable price and score information, understandable game states, and accessible controls; bespoke visual theming is out of scope.

## Nice to have

- Remember a player after the browser closes and reopens.
- Show a small leaderboard of display names and scores.

## Scope boundary

The first goal is a complete, working game with backend-persisted scores, meaningful tests, a public deployment, and a useful README. Browser-return persistence and a public leaderboard are optional. User accounts, guess history, and real-time market streaming are not needed for the initial demo.
