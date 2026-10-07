export class StorageUnavailable extends Error {}
// Fastify framework errors are duck-typed: they carry a string `code` and a
// numeric 4xx `statusCode`. Returns that status for recognized client errors.
export function frameworkErrorStatus(error: unknown): number | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("FST_ERR_") &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
    return error.statusCode;
  return undefined;
}
export function statusToErrorCode(status: number): string {
  return status === 400
    ? "invalid_body"
    : status === 413
      ? "payload_too_large"
      : status === 415
        ? "unsupported_media_type"
        : "invalid_request";
}
