// Same-origin JSON client for the BTC Guesser player API.
//
// Deliberately thin: it sends requests and reports the backend's error code and
// correlation id. It owns no game rules, no error taxonomy, and no retry policy.
// The private session credential lives only in the HttpOnly `btc_player` cookie,
// so this module uses `credentials: "same-origin"` and never reads cookies or
// web storage.

import type { ApiError, Direction, PlayerState } from "@/game/types";

/** A classified API failure that also satisfies the frozen `ApiError` shape. */
export class ApiRequestError extends Error implements ApiError {
  readonly name = "ApiRequestError";
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(code: string, status: number | null, requestId: string | null) {
    super(`API request failed: ${code}`);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/** Converts an unknown thrown value into a safe `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiRequestError) {
    return {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    };
  }
  return { code: "unknown", status: null, requestId: null };
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
 * only for a fresh 201; a 200 means the session was already valid.
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
    throw new ApiRequestError(
      await errorCode(response),
      response.status,
      requestId,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError("unknown", response.status, requestId);
  }
  if (!isRecord(data)) {
    throw new ApiRequestError("unknown", response.status, requestId);
  }

  return { response, data: data as T };
}

/** Reads the backend correlation id defensively; never invents one. */
function readRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? null;
}

/** Uses the backend's `error` code when present; otherwise a coarse fallback. */
async function errorCode(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return defaultCodeForStatus(response.status);
  }
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }
  return defaultCodeForStatus(response.status);
}

/**
 * Fallback classification for unrecognized error bodies. Unknown routes return
 * a bare 404 that must not be mistaken for a validation failure.
 */
function defaultCodeForStatus(status: number): string {
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
