# T101 — Remember players after the browser closes

**Goal:** Restore the player’s score and active guess on a later visit in the same browser.

**Scope:** Make the session cookie persistent and retain the player/session mapping in DynamoDB. This does not add passwords or cross-device recovery.

**Dependencies:** T007.

**Done when:** Closing and reopening the browser restores the same player; clearing the cookie creates a new player.
