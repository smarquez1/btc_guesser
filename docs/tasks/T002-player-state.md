# T002 — Persist player profiles and game state

**Goal:** Store player scores and active/latest guesses in DynamoDB.

**Scope:** Collect a display name and associate a backend-generated player ID with a session cookie. Add backend operations to read player state and accept one Up/Down guess. Treat the name as a label, not authentication. Enforce one active guess and server-owned starting price/time. A session-only cookie is sufficient for the core version.

**Dependencies:** T001.

**Done when:** A player has a stable identity during the browser session; new players start at zero; a second active guess is rejected; scores and game state are stored in DynamoDB.
