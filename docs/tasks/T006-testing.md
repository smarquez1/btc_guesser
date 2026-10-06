# T006 — Verify the core journey

**Goal:** Test critical behavior without building a large or redundant E2E suite.

**Scope:** Use Vitest for game rules and API behavior, React Testing Library for UI behavior, and one focused Playwright journey. Use deterministic price and time in tests. Follow the project testing skill where useful without adding its optional dependencies by default.

**Dependencies:** T002–T005.

**Done when:** Tests cover the 60-second minimum, pre-deadline movement that remains different at the deadline, equal-price pending behavior, scoring, duplicate-guess prevention, and in-session state. Tests do not use live Coinbase data or wait a real minute.
