import { describe, expect, it } from "vitest";
import { persistenceConfigError } from "./production-config.js";

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
