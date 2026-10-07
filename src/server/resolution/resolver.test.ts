import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DueGuess,
  ObsoleteGuessConflict,
  type PendingGuess,
  type PlayerRecord,
  type PlayerStore,
} from "../domain/player.js";
import { StorageDeadlineError } from "../persistence/player-store.js";
import type { PriceObservation } from "../pricing/policy.js";
import { createResolver, resolverPolicy } from "./resolver.js";

const epoch = Date.parse("2026-10-06T00:00:00Z");
const playerId = "player-1";
const player: PlayerRecord = {
  playerId,
  displayName: "Ada",
  sessionDigest: "digest",
  score: 0,
};

type LogEntry = {
  level: "info" | "warn" | "error";
  fields: Record<string, unknown>;
  message: string;
};

function fixture() {
  const entries: LogEntry[] = [];
  const log = {
    info: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "info", fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "warn", fields, message });
    },
    error: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "error", fields, message });
    },
  };
  const store: PlayerStore = {
    create: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    accept: vi.fn(async () => player),
    due: vi.fn(async () => [] as DueGuess[]),
    resolve: vi.fn(async () => player),
  };
  return { entries, log, store };
}

function guess(overrides: Partial<PendingGuess> = {}): PendingGuess {
  return {
    id: "guess-1",
    direction: "up",
    startingPrice: "100",
    acceptedAt: epoch,
    eligibleAt: epoch + 60_000,
    ...overrides,
  };
}

function observation(price: string, receivedAt: number): PriceObservation {
  return {
    price,
    providerTradeAt: new Date(receivedAt).toISOString(),
    receivedAt,
  };
}

const dueGuess = (pending: PendingGuess, id = playerId): DueGuess => ({
  playerId: id,
  guess: pending,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createResolver", () => {
  it("resolves eligible differing guesses with the rule score for both directions", async () => {
    const cases = [
      {
        direction: "up" as const,
        price: "101",
        result: "correct" as const,
        scoreDelta: 1 as const,
      },
      {
        direction: "up" as const,
        price: "99",
        result: "incorrect" as const,
        scoreDelta: -1 as const,
      },
      {
        direction: "down" as const,
        price: "99",
        result: "correct" as const,
        scoreDelta: 1 as const,
      },
      {
        direction: "down" as const,
        price: "101",
        result: "incorrect" as const,
        scoreDelta: -1 as const,
      },
    ];
    for (const item of cases) {
      const f = fixture();
      const pending = guess({ direction: item.direction });
      vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
      const resolver = createResolver({
        store: f.store,
        trusted: async () => observation(item.price, pending.eligibleAt),
        now: () => pending.eligibleAt,
        log: f.log,
        runId: () => "run-1",
      });
      await resolver.sweep();
      expect(f.store.resolve).toHaveBeenCalledWith(playerId, {
        ...pending,
        result: item.result,
        scoreDelta: item.scoreDelta,
        resolvedAt: pending.eligibleAt,
        observedPrice: item.price,
        observedAt: pending.eligibleAt,
      });
      await resolver.close();
    }
  });

  it("keeps ineligible, equal, and unavailable observations pending without writes", async () => {
    const pending = guess();
    const scenarios = [
      {
        label: "equal price",
        price: "100",
        receivedAt: pending.eligibleAt,
        at: pending.eligibleAt,
      },
      {
        label: "before deadline",
        price: "101",
        receivedAt: pending.eligibleAt,
        at: pending.eligibleAt - 1,
      },
      {
        label: "pre-deadline receipt",
        price: "101",
        receivedAt: pending.eligibleAt - 1,
        at: pending.eligibleAt,
      },
    ];
    for (const scenario of scenarios) {
      const f = fixture();
      vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
      const resolver = createResolver({
        store: f.store,
        trusted: async () => observation(scenario.price, scenario.receivedAt),
        now: () => scenario.at,
        log: f.log,
        runId: () => "run-1",
      });
      await resolver.sweep();
      expect(f.store.resolve).not.toHaveBeenCalled();
      expect(f.entries.filter((entry) => entry.level !== "info")).toEqual([]);
      await resolver.close();
    }

    const f = fixture();
    vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
    const resolver = createResolver({
      store: f.store,
      trusted: async () => null,
      now: () => pending.eligibleAt,
      log: f.log,
      runId: () => "run-1",
    });
    await resolver.sweep();
    expect(f.store.resolve).not.toHaveBeenCalled();
    expect(f.entries.filter((entry) => entry.level !== "info")).toEqual([]);
    await resolver.close();
  });

  it("leaves a due guess pending when the trusted observation is stale", async () => {
    const f = fixture();
    const pending = guess();
    vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
    const resolver = createResolver({
      store: f.store,
      // The receipt is 60s old at decision time, beyond the 15s freshness bound.
      trusted: async () => observation("101", pending.eligibleAt),
      now: () => pending.eligibleAt + 60_000,
      log: f.log,
      runId: () => "run-1",
    });
    await resolver.sweep();
    expect(f.store.resolve).not.toHaveBeenCalled();
    expect(f.entries.filter((entry) => entry.level === "error")).toEqual([]);
    await resolver.close();
  });

  it("degrades discovery and skips resolution when due discovery hits the storage deadline", async () => {
    const f = fixture();
    vi.mocked(f.store.due).mockRejectedValue(new StorageDeadlineError());
    const resolver = createResolver({
      store: f.store,
      trusted: async () => observation("101", epoch),
      now: () => epoch,
      log: f.log,
      runId: () => "run-1",
    });
    await resolver.sweep();
    expect(f.store.resolve).not.toHaveBeenCalled();
    const errors = f.entries.filter((entry) => entry.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields).toMatchObject({
      event: "resolver_operation_degraded",
      category: "persistence_failure",
      operation: "discovery",
    });
    await resolver.close();
  });

  it("classifies obsolete-guess conflicts as expected and rate-limits aggregation", async () => {
    const f = fixture();
    const pending = guess();
    vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
    vi.mocked(f.store.resolve).mockRejectedValue(new ObsoleteGuessConflict());
    const clock = { value: pending.eligibleAt };
    const resolver = createResolver({
      store: f.store,
      trusted: async () => observation("101", clock.value),
      now: () => clock.value,
      log: f.log,
      runId: () => "run-1",
    });
    const conflicts = () =>
      f.entries.filter((entry) => entry.fields.event === "resolver_conflicts");
    await resolver.sweep();
    await resolver.sweep();
    expect(conflicts()).toHaveLength(1);
    expect(conflicts()[0]).toMatchObject({
      level: "info",
      fields: { category: "expected", count: 1 },
    });
    expect(f.entries.filter((entry) => entry.level === "error")).toEqual([]);
    clock.value += 60_000;
    await resolver.sweep();
    expect(conflicts()).toHaveLength(2);
    expect(conflicts()[1]).toMatchObject({ fields: { count: 2 } });
    await resolver.close();
  });

  it("degrades discovery once per minute with a retry hint and recovers once", async () => {
    const f = fixture();
    const secret = "SEEDED_DISCOVERY_SECRET";
    vi.mocked(f.store.due)
      .mockRejectedValueOnce(new Error(secret))
      .mockRejectedValueOnce(new Error(secret));
    const clock = { value: epoch };
    const resolver = createResolver({
      store: f.store,
      trusted: async () => null,
      now: () => clock.value,
      log: f.log,
      runId: () => "run-1",
    });
    const errors = () => f.entries.filter((entry) => entry.level === "error");
    await resolver.sweep();
    expect(errors()).toHaveLength(1);
    expect(errors()[0]?.fields).toMatchObject({
      event: "resolver_operation_degraded",
      category: "persistence_failure",
      operation: "discovery",
      retryInMs: resolverPolicy.pollMs,
      runId: "run-1",
    });
    expect(errors()[0]?.fields.elapsedMs).toEqual(expect.any(Number));
    expect(f.store.resolve).not.toHaveBeenCalled();
    clock.value += 30_000;
    await resolver.sweep();
    expect(errors()).toHaveLength(1);
    expect(f.store.resolve).not.toHaveBeenCalled();
    clock.value += 30_000;
    vi.mocked(f.store.due).mockResolvedValue([]);
    await resolver.sweep();
    const recovered = f.entries.filter(
      (entry) => entry.fields.event === "resolver_operation_recovered",
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.fields).toMatchObject({
      category: "recovery",
      operation: "discovery",
    });
    expect(JSON.stringify(f.entries)).not.toContain(secret);
    await resolver.close();
  });

  it("degrades resolution but keeps processing the batch and recovers once", async () => {
    const f = fixture();
    const first = guess({ id: "guess-1" });
    const second = guess({ id: "guess-2" });
    vi.mocked(f.store.due).mockResolvedValue([
      dueGuess(first, "p1"),
      dueGuess(second, "p2"),
    ]);
    const secret = "SEEDED_RESOLUTION_SECRET";
    vi.mocked(f.store.resolve)
      .mockRejectedValueOnce(new Error(secret))
      .mockResolvedValue(player);
    const resolver = createResolver({
      store: f.store,
      trusted: async () => observation("101", first.eligibleAt),
      now: () => first.eligibleAt,
      log: f.log,
      runId: () => "run-1",
    });
    await resolver.sweep();
    expect(f.store.resolve).toHaveBeenCalledTimes(2);
    const errors = f.entries.filter((entry) => entry.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields).toMatchObject({
      operation: "resolution",
      category: "persistence_failure",
      retryInMs: resolverPolicy.pollMs,
    });
    const recovered = f.entries.filter(
      (entry) => entry.fields.event === "resolver_operation_recovered",
    );
    expect(recovered).toHaveLength(1);
    expect(JSON.stringify(f.entries)).not.toContain(secret);
    await resolver.close();
  });

  it("sweeps immediately, schedules after settle, and never overlaps", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let firstResolve!: (value: DueGuess[]) => void;
      let secondResolve!: (value: DueGuess[]) => void;
      let calls = 0;
      vi.mocked(f.store.due).mockImplementation(() => {
        const index = calls++;
        return new Promise<DueGuess[]>((resolve) => {
          if (index === 0) firstResolve = resolve;
          else secondResolve = resolve;
        });
      });
      const resolver = createResolver({
        store: f.store,
        trusted: async () => null,
        now: () => epoch,
        log: f.log,
        runId: () => "run-1",
      });
      resolver.start();
      resolver.start();
      expect(f.store.due).toHaveBeenCalledTimes(1);
      // The first pass is still pending, so no poll can start a second sweep.
      await vi.advanceTimersByTimeAsync(resolverPolicy.pollMs * 2);
      expect(f.store.due).toHaveBeenCalledTimes(1);
      firstResolve([]);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(resolverPolicy.pollMs - 1);
      expect(f.store.due).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.store.due).toHaveBeenCalledTimes(2);
      // A manual sweep shares the in-flight pass; the timer cannot add a third.
      const manual = resolver.sweep();
      expect(f.store.due).toHaveBeenCalledTimes(2);
      secondResolve([]);
      await manual;
      await resolver.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close waits for in-flight work, clears the timer, and stops once", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let release!: (value: DueGuess[]) => void;
      vi.mocked(f.store.due).mockImplementation(
        () =>
          new Promise<DueGuess[]>((resolve) => {
            release = resolve;
          }),
      );
      const resolver = createResolver({
        store: f.store,
        trusted: async () => null,
        now: () => epoch,
        log: f.log,
        runId: () => "run-1",
      });
      resolver.start();
      await vi.advanceTimersByTimeAsync(0);
      let finished = false;
      const closing = resolver.close().then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      const stopped = () =>
        f.entries.filter((entry) => entry.fields.event === "resolver_stopped");
      expect(finished).toBe(false);
      expect(stopped()).toHaveLength(0);
      release([]);
      await closing;
      expect(finished).toBe(true);
      expect(stopped()).toHaveLength(1);
      expect(stopped()[0]).toMatchObject({
        level: "info",
        fields: { category: "lifecycle", runId: "run-1" },
      });
      await resolver.close();
      expect(stopped()).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(resolverPolicy.pollMs * 3);
      expect(f.store.due).toHaveBeenCalledTimes(1);
      expect(stopped()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers persisted guesses on a fresh instance start with bounded counts", async () => {
    const f = fixture();
    const pending = guess();
    vi.mocked(f.store.due).mockResolvedValue([dueGuess(pending)]);
    const resolver = createResolver({
      store: f.store,
      trusted: async () => observation("101", pending.eligibleAt),
      now: () => pending.eligibleAt,
      log: f.log,
      runId: () => "run-1",
    });
    resolver.start();
    await resolver.sweep();
    expect(f.store.resolve).toHaveBeenCalledTimes(1);
    const resumed = f.entries.filter(
      (entry) => entry.fields.event === "resolver_resumed",
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      level: "info",
      fields: {
        category: "recovery",
        runId: "run-1",
        due: 1,
        resolved: 1,
        conflicts: 0,
      },
    });
    expect(resumed[0]?.fields.elapsedMs).toEqual(expect.any(Number));
    await resolver.close();
  });

  it("redacts seeded errors and emits only fixed diagnostic fields", async () => {
    const f = fixture();
    const secret = "SEEDED_SECRET";
    const token = "a".repeat(64);
    const name = "Ada_PRIVATE_NAME";
    const record = { playerId: "SEEDED_PLAYER_ID", guessId: "SEEDED_GUESS_ID" };
    const seeded = () =>
      Object.assign(
        new Error(`${secret} ${token} ${name} ${JSON.stringify(record)}`),
        {
          name: "SEEDED_ERROR_NAME",
          request: { cookie: token },
          item: record,
        },
      );

    vi.mocked(f.store.due).mockRejectedValueOnce(seeded());
    const discovery = createResolver({
      store: f.store,
      trusted: async () => null,
      now: () => epoch,
      log: f.log,
      runId: () => "run-discovery",
    });
    await discovery.sweep();

    const pending = guess();
    vi.mocked(f.store.due).mockResolvedValue([
      dueGuess(pending, "SEEDED_PLAYER_ID"),
    ]);
    vi.mocked(f.store.resolve).mockRejectedValueOnce(seeded());
    const resolution = createResolver({
      store: f.store,
      trusted: async () => observation("101", pending.eligibleAt),
      now: () => pending.eligibleAt,
      log: f.log,
      runId: () => "run-resolution",
    });
    await resolution.sweep();

    vi.mocked(f.store.resolve).mockRejectedValue(new ObsoleteGuessConflict());
    await resolution.sweep();

    const provider = createResolver({
      store: f.store,
      trusted: async () => {
        throw seeded();
      },
      now: () => pending.eligibleAt,
      log: f.log,
      runId: () => "run-provider",
    });
    await provider.sweep();

    await resolution.close();
    await provider.close();

    const printed = JSON.stringify(f.entries);
    for (const value of [
      secret,
      token,
      name,
      "SEEDED_PLAYER_ID",
      "SEEDED_GUESS_ID",
      "SEEDED_ERROR_NAME",
    ])
      expect(printed).not.toContain(value);

    const allowed: Record<string, string[] | undefined> = {
      resolver_started: ["event", "category", "runId", "pollMs", "batchLimit"],
      resolver_stopped: ["event", "category", "runId"],
      resolver_resumed: [
        "event",
        "category",
        "runId",
        "jobId",
        "due",
        "resolved",
        "conflicts",
        "elapsedMs",
      ],
      resolver_operation_degraded: [
        "event",
        "category",
        "operation",
        "runId",
        "jobId",
        "retryInMs",
        "elapsedMs",
      ],
      resolver_operation_recovered: [
        "event",
        "category",
        "operation",
        "runId",
        "jobId",
      ],
      resolver_conflicts: ["event", "category", "runId", "count"],
    };
    expect(f.entries.length).toBeGreaterThan(0);
    for (const entry of f.entries) {
      const event = String(entry.fields.event);
      expect(allowed[event]).toBeDefined();
      expect(Object.keys(entry.fields).sort()).toEqual(
        [...(allowed[event] ?? [])].sort(),
      );
    }
  });
});
