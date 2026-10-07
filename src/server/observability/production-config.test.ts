import { describe, expect, it } from "vitest";
import {
  persistenceConfigError,
  timingConfigError,
} from "./production-config.js";

describe("persistenceConfigError", () => {
  it("refuses to start in production without persistence", () => {
    expect(persistenceConfigError(true, false)).toBe(
      "DYNAMODB_TABLE is required in production; refusing to start",
    );
  });

  it("allows production with persistence", () => {
    expect(persistenceConfigError(true, true)).toBeNull();
  });

  it("allows non-production without persistence", () => {
    expect(persistenceConfigError(false, false)).toBeNull();
  });
});

describe("timingConfigError", () => {
  it("refuses to start in production below the 60s minimum wait", () => {
    expect(timingConfigError(true, 59_999)).toBe(
      "GUESS_MIN_WAIT_MS below 60000 is not allowed in production; refusing to start",
    );
  });

  it("allows production at exactly the 60s minimum wait", () => {
    expect(timingConfigError(true, 60_000)).toBeNull();
  });

  it("allows production above the 60s minimum wait", () => {
    expect(timingConfigError(true, 120_000)).toBeNull();
  });

  it("allows non-production below the 60s minimum wait", () => {
    expect(timingConfigError(false, 1_000)).toBeNull();
  });
});
