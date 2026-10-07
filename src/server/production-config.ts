// Startup configuration guards. Kept pure so they can be tested without
// importing the side-effecting server entrypoint (which listens on import).
export function persistenceConfigError(
  production: boolean,
  hasPersistence: boolean,
): string | null {
  if (production && !hasPersistence)
    return "DYNAMODB_TABLE is required in production; refusing to start";
  return null;
}
