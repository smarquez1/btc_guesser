// Same-origin JSON client for the BTC Guesser player API.
//
// The private session credential lives only in the HttpOnly `btc_player`
// cookie, so this module deliberately uses `credentials: "same-origin"` and
// never reads cookies or web storage. Failures are translated into the frozen
// `ApiError` shape used by the data/logic layer and diagnostics.

import type {
  ApiError,
  ApiErrorCode,
  DiagnosticCategory,
  Direction,
  PlayerState,
} from "@/game/types";

const VALIDATION_CODES = new Set<ApiErrorCode>([
  "invalid_display_name",
  "invalid_direction",
  "invalid_body",
  "payload_too_large",
  "unsupported_media_type",
  "invalid_request",
]);

const SESSION_CODES = new Set<ApiErrorCode>(["unauthorized"]);
const CONFLICT_CODES = new Set<ApiErrorCode>(["active_guess"]);
const PROVIDER_CODES = new Set<ApiErrorCode>(["price_unavailable"]);
const STORAGE_CODES = new Set<ApiErrorCode>(["persistence_unavailable"]);
const NETWORK_CODES = new Set<ApiErrorCode>(["network"]);

/** Every error code the backend is documented to return. */
const KNOWN_ERROR_CODES = new Set<ApiErrorCode>([
  ...VALIDATION_CODES,
  ...SESSION_CODES,
  ...CONFLICT_CODES,
  ...PROVIDER_CODES,
  ...STORAGE_CODES,
  ...NETWORK_CODES,
  "unknown",
]);

/** Maps a backend error code to the diagnostic class surfaced to developers. */
export function categoryForCode(
  code: ApiErrorCode,
  _status: number | null,
): DiagnosticCategory {
  if (VALIDATION_CODES.has(code)) return "validation";
  if (SESSION_CODES.has(code)) return "session";
  if (CONFLICT_CODES.has(code)) return "conflict";
  if (PROVIDER_CODES.has(code)) return "provider";
  if (STORAGE_CODES.has(code)) return "storage";
  if (NETWORK_CODES.has(code)) return "network";
  return "unknown";
}

/**
 * Whether retrying the same request could plausibly succeed. Client/input
 * problems, missing sessions, and active-guess conflicts need caller action
 * rather than a blind retry.
 */
export function isRetryableCode(
  code: ApiErrorCode,
  status: number | null,
): boolean {
  if (
    VALIDATION_CODES.has(code) ||
    SESSION_CODES.has(code) ||
    CONFLICT_CODES.has(code)
  ) {
    return false;
  }
  if (
    PROVIDER_CODES.has(code) ||
    STORAGE_CODES.has(code) ||
    NETWORK_CODES.has(code)
  ) {
    return true;
  }
  return status === null || status >= 500;
}

/** A classified API failure that also satisfies the frozen `ApiError` shape. */
export class ApiRequestError extends Error implements ApiError {
  readonly name = "ApiRequestError";
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly category: DiagnosticCategory;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    status: number | null,
    requestId: string | null,
    retryable?: boolean,
  ) {
    super(`API request failed: ${code}`);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.category = categoryForCode(code, status);
    this.retryable = retryable ?? isRetryableCode(code, status);
  }
}

/** Converts an unknown thrown value into a safe, classified `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiRequestError) {
    return {
      code: error.code,
      status: error.status,
      category: error.category,
      requestId: error.requestId,
      retryable: error.retryable,
    };
  }
  return {
    code: "unknown",
    status: null,
    category: "unknown",
    requestId: null,
    retryable: false,
  };
}

/** Fetches the current player state, or fails with `unauthorized`. */
export async function getPlayer(signal?: AbortSignal): Promise<PlayerState> {
  const { data } = await requestJson<PlayerState>("/api/player", {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });
  return data;
}

/**
 * Creates a player, or reuses the existing valid session. `created` is true
 * only for a fresh 201; a 200 means the session was already valid and the
 * state is unchanged.
 */
export async function createPlayer(
  displayName: string,
  signal?: AbortSignal,
): Promise<{ player: PlayerState; created: boolean }> {
  const { response, data } = await requestJson<PlayerState>("/api/players", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ displayName }),
    signal,
  });
  return { player: data, created: response.status === 201 };
}

/** Submits a guess; the server owns all pricing and outcome decisions. */
export async function submitGuess(
  direction: Direction,
  signal?: AbortSignal,
): Promise<PlayerState> {
  const { data } = await requestJson<PlayerState>("/api/guesses", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ direction }),
    signal,
  });
  return data;
}

interface JsonResult<T> {
  response: Response;
  data: T;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
): Promise<JsonResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...init });
  } catch (error) {
    // Aborts are caller-driven cancellation, not failures to classify.
    if (isAbortError(error)) throw error;
    throw new ApiRequestError("network", null, null);
  }

  const requestId = readRequestId(response.headers);

  if (!response.ok) {
    const code = await classifyFailureCode(response);
    throw new ApiRequestError(code, response.status, requestId);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError("unknown", response.status, requestId, true);
  }
  if (!isRecord(data)) {
    throw new ApiRequestError("unknown", response.status, requestId, true);
  }

  return { response, data: data as T };
}

/** Reads the backend correlation id defensively; never invents one. */
function readRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? null;
}

async function classifyFailureCode(response: Response): Promise<ApiErrorCode> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return defaultCodeForStatus(response.status);
  }
  if (
    isRecord(body) &&
    typeof body.error === "string" &&
    KNOWN_ERROR_CODES.has(body.error as ApiErrorCode)
  ) {
    return body.error as ApiErrorCode;
  }
  return defaultCodeForStatus(response.status);
}

/**
 * Fallback classification for unrecognized error bodies. Unknown routes return
 * a bare 404 that must not be mistaken for a validation failure.
 */
function defaultCodeForStatus(status: number): ApiErrorCode {
  if (status === 404) return "unknown";
  if (status >= 400 && status <= 499) return "invalid_request";
  return "unknown";
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return isRecord(error) && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
