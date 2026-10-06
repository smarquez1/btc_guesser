# T004 — Implement guess resolution and scoring

**Goal:** Apply the assignment’s timing, comparison, one-active-guess, and scoring rules on the backend.

**Scope:** Keep game rules independent of Fastify. Record the server acceptance time and starting price. Do not resolve before 60 seconds. At or after the deadline, resolve on the first fresh price observation received by the backend that differs from the starting price; a pre-deadline move counts if it remains different when observed after the deadline. Equal or unavailable observations stay pending. Update score and result atomically so retries cannot score twice.

**Dependencies:** T002 and T003.

**Done when:** No early resolution occurs; equal prices stay pending; a differing post-deadline observation resolves; direction determines `+1` or `−1`; repeated resolution cannot update the score twice. Use controlled time and price observations in tests.
