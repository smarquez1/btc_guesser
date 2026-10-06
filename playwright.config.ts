import { defineConfig, devices } from "@playwright/test";

// `webServer.env` is typed as `{ [key: string]: string }`, while `process.env`
// values are `string | undefined`; forward only the defined entries.
const inheritedEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: "./test-results",
  // Artifacts are disabled entirely: no traces, screenshots, or video.
  use: {
    baseURL: "http://127.0.0.1:5373",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: [
    {
      command:
        "node --env-file-if-exists=.env --import tsx tests/e2e/server.ts",
      url: "http://127.0.0.1:3300/api/health",
      reuseExistingServer: !process.env.CI,
      env: { ...inheritedEnv, GUESS_MIN_WAIT_MS: "1000" },
    },
    {
      command: "pnpm exec vite --config vite.e2e.config.ts",
      url: "http://127.0.0.1:5373",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
