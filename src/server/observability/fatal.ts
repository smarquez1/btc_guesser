export interface FatalDependencies {
  log: { error: (fields: { kind: string; name: string }) => void };
  exit: (code: number) => void;
}

// Fatal handlers log only the kind and error name, never message/stack, and exit
// without the graceful path: an unknown state should not be drained.
export function createFatalHandler({ log, exit }: FatalDependencies) {
  return (kind: string, name: string): void => {
    try {
      log.error({ kind, name });
    } catch {
      // Logging must never prevent the fatal exit.
    }
    exit(1);
  };
}
