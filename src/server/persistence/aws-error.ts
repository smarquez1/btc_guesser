// The AWS SDK surfaces typed failures by `name`; instanceof does not survive
// marshalled/cross-realm errors, so match the stable name.
export function isAwsError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}
