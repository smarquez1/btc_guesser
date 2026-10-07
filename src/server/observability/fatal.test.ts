import { describe, expect, it, vi } from "vitest";
import { createFatalHandler } from "./fatal.js";

describe("createFatalHandler", () => {
  it("logs only kind and name, then exits with code 1", () => {
    const error = vi.fn();
    const exit = vi.fn();
    const fatal = createFatalHandler({ log: { error }, exit });

    fatal("uncaughtException", "TypeError");

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({
      kind: "uncaughtException",
      name: "TypeError",
    });
    const fields = error.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["kind", "name"]);
    expect(fields).not.toHaveProperty("message");
    expect(fields).not.toHaveProperty("stack");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still exits with code 1 when logging throws", () => {
    const exit = vi.fn();
    const fatal = createFatalHandler({
      log: {
        error: () => {
          throw new Error("logger down");
        },
      },
      exit,
    });

    fatal("unhandledRejection", "Error");

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
