import { randomUUID } from "node:crypto";
import { resolverDiagnostics } from "./diagnostics.js";
import type { ResolverLog } from "./log.js";
import {
  type DueGuess,
  ObsoleteGuessConflict,
  type PlayerStore,
} from "./players.js";
import type { PriceObservation } from "./pricing.js";
import { resolveGuess } from "./resolution.js";

export const resolverPolicy = { pollMs: 5_000, batchLimit: 100 } as const;

export interface ResolverOptions {
  store: PlayerStore;
  trusted: () => Promise<PriceObservation | null>;
  now?: () => number;
  log?: ResolverLog;
  pollMs?: number;
  batchLimit?: number;
  runId?: () => string;
}

export interface Resolver {
  start(): void;
  close(): Promise<void>;
  sweep(): Promise<void>;
}

export function createResolver(options: ResolverOptions): Resolver {
  const { store, trusted } = options;
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? resolverPolicy.pollMs;
  const batchLimit = options.batchLimit ?? resolverPolicy.batchLimit;
  const runId = (options.runId ?? randomUUID)();
  const diagnostics = resolverDiagnostics(now, options.log, runId);

  let started = false;
  let closed = false;
  let firstSweepComplete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | undefined;

  // One pass. Every awaited dependency is wrapped so a rejection cannot escape
  // the sweep; degraded work always leaves the guess pending for the next poll.
  async function execute(): Promise<void> {
    const jobId = randomUUID();
    const began = now();
    let due: DueGuess[];
    try {
      due = await store.due(now(), batchLimit);
    } catch {
      diagnostics.degraded("discovery", {
        jobId,
        elapsedMs: now() - began,
        retryInMs: pollMs,
      });
      return;
    }
    diagnostics.recovered("discovery", jobId);

    let observation: PriceObservation | null;
    try {
      // One provider read is shared by every guess in the batch.
      observation = await trusted();
    } catch {
      diagnostics.degraded("provider", {
        jobId,
        elapsedMs: now() - began,
        retryInMs: pollMs,
      });
      return;
    }
    // A null observation is a quiet provider state; pricing owns its diagnostics.
    if (!observation) return;
    diagnostics.recovered("provider", jobId);

    let resolved = 0;
    let conflicts = 0;
    for (const item of due) {
      try {
        const resolution = resolveGuess(item.guess, observation, now());
        if (!resolution) continue;
        await store.resolve(item.playerId, { ...item.guess, ...resolution });
      } catch (error) {
        // Already resolved, replaced, or missing player is an expected race.
        if (error instanceof ObsoleteGuessConflict) {
          conflicts += 1;
          continue;
        }
        diagnostics.degraded("resolution", {
          jobId,
          elapsedMs: now() - began,
          retryInMs: pollMs,
        });
        continue;
      }
      resolved += 1;
      diagnostics.recovered("resolution", jobId);
    }
    if (conflicts > 0) diagnostics.conflicts(conflicts);

    // The first successful pass is the restart/wake recovery observation;
    // later due guesses are ordinary gameplay, not recovery.
    if (!firstSweepComplete) {
      firstSweepComplete = true;
      if (due.length > 0)
        diagnostics.resumed(jobId, {
          due: due.length,
          resolved,
          conflicts,
          elapsedMs: now() - began,
        });
    }
  }

  function sweep(): Promise<void> {
    if (closed) return Promise.resolve();
    if (inflight) return inflight;
    const job = execute();
    inflight = job;
    void job.finally(() => {
      if (inflight === job) inflight = undefined;
    });
    return job;
  }

  // Schedule the next poll only after the previous sweep settles, so a slow
  // pass can never overlap itself (no setInterval).
  function run(): void {
    void sweep().finally(() => {
      if (!closed) timer = setTimeout(run, pollMs);
    });
  }

  function start(): void {
    if (started || closed) return;
    started = true;
    diagnostics.started(pollMs, batchLimit);
    run();
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    timer = undefined;
    await inflight;
    diagnostics.stopped();
  }

  return { start, close, sweep };
}
