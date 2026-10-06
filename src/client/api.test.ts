import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  categoryForCode,
  createPlayer,
  getPlayer,
  isRetryableCode,
  submitGuess,
  toApiError,
} from "./api";

const player = {
  id: "player-1",
  displayName: "Ada",
  score: 0,
  activeGuess: null,
  latestGuess: null,
  pricing: { status: "unavailable", observation: null },
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function installFetch() {
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  it("GETs the player with same-origin credentials and JSON accept header", async () => {
    installFetch();
    fetchMock.mockResolvedValue(jsonResponse(player));

    await expect(getPlayer()).resolves.toEqual(player);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/player");
    const init = call?.[1];
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.body).toBeUndefined();
  });

  it("POSTs only the displayName field and reports created for a 201", async () => {
    installFetch();
    fetchMock.mockResolvedValue(jsonResponse(player, 201));

    await expect(createPlayer("Ada")).resolves.toEqual({
      player,
      created: true,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/players");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ displayName: "Ada" });
  });

  it("treats a 200 from createPlayer as an unchanged existing session", async () => {
    installFetch();
    fetchMock.mockResolvedValue(jsonResponse(player, 200));

    await expect(createPlayer("Ada")).resolves.toEqual({
      player,
      created: false,
    });
  });

  it("POSTs only the direction field when submitting a guess", async () => {
    installFetch();
    fetchMock.mockResolvedValue(jsonResponse(player, 201));

    await expect(submitGuess("up")).resolves.toEqual(player);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/guesses");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ direction: "up" });
  });

  it("captures a correlation id from either response header", async () => {
    installFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "persistence_unavailable" }, 503, {
        "x-request-id": "req-abc",
      }),
    );

    const error = await getPlayer().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).requestId).toBe("req-abc");

    fetchMock.mockResolvedValue(
      jsonResponse({ error: "active_guess" }, 409, { "request-id": "req-def" }),
    );
    const second = await getPlayer().catch((thrown: unknown) => thrown);
    expect((second as ApiRequestError).requestId).toBe("req-def");
  });

  it("leaves requestId null when no correlation header is present", async () => {
    installFetch();
    fetchMock.mockResolvedValue(jsonResponse({ error: "active_guess" }, 409));

    const error = await getPlayer().catch((thrown: unknown) => thrown);
    expect((error as ApiRequestError).requestId).toBeNull();
  });

  it("maps each documented error code to category, status, and retryability", async () => {
    const cases: Array<{
      code: string;
      status: number;
      category: string;
      retryable: boolean;
    }> = [
      {
        code: "invalid_display_name",
        status: 400,
        category: "validation",
        retryable: false,
      },
      {
        code: "invalid_direction",
        status: 400,
        category: "validation",
        retryable: false,
      },
      {
        code: "invalid_body",
        status: 400,
        category: "validation",
        retryable: false,
      },
      {
        code: "payload_too_large",
        status: 413,
        category: "validation",
        retryable: false,
      },
      {
        code: "unsupported_media_type",
        status: 415,
        category: "validation",
        retryable: false,
      },
      {
        code: "unauthorized",
        status: 401,
        category: "session",
        retryable: false,
      },
      {
        code: "active_guess",
        status: 409,
        category: "conflict",
        retryable: false,
      },
      {
        code: "price_unavailable",
        status: 503,
        category: "provider",
        retryable: true,
      },
      {
        code: "persistence_unavailable",
        status: 503,
        category: "storage",
        retryable: true,
      },
    ];

    for (const testCase of cases) {
      installFetch();
      fetchMock.mockResolvedValue(
        jsonResponse({ error: testCase.code }, testCase.status),
      );
      const error = (await submitGuess("down").catch(
        (thrown: unknown) => thrown,
      )) as ApiRequestError;
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error.code).toBe(testCase.code);
      expect(error.category).toBe(testCase.category);
      expect(error.status).toBe(testCase.status);
      expect(error.retryable).toBe(testCase.retryable);
      expect(categoryForCode(error.code, error.status)).toBe(testCase.category);
      expect(isRetryableCode(error.code, error.status)).toBe(
        testCase.retryable,
      );
      vi.unstubAllGlobals();
    }
  });

  it("classifies unrecognized 4xx and 5xx bodies without crashing", async () => {
    installFetch();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 404, error: "Not Found", message: "Route not found" },
        404,
      ),
    );
    const notFound = (await getPlayer().catch(
      (thrown: unknown) => thrown,
    )) as ApiRequestError;
    expect(notFound).toBeInstanceOf(ApiRequestError);
    expect(notFound.code).toBe("unknown");
    expect(notFound.status).toBe(404);
    expect(notFound.category).toBe("unknown");
    expect(notFound.retryable).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    const server = (await getPlayer().catch(
      (thrown: unknown) => thrown,
    )) as ApiRequestError;
    expect(server.code).toBe("unknown");
    expect(server.status).toBe(500);
    expect(server.retryable).toBe(true);
  });

  it("treats a network rejection as a retryable network error", async () => {
    installFetch();
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    const error = (await getPlayer().catch(
      (thrown: unknown) => thrown,
    )) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe("network");
    expect(error.status).toBeNull();
    expect(error.category).toBe("network");
    expect(error.requestId).toBeNull();
    expect(error.retryable).toBe(true);
    expect(toApiError(error)).toEqual({
      code: "network",
      status: null,
      category: "network",
      requestId: null,
      retryable: true,
    });
  });

  it("rethrows abort errors unchanged instead of classifying them", async () => {
    installFetch();
    const abort = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockImplementation(() => Promise.reject(abort));

    await expect(getPlayer()).rejects.toBe(abort);

    const namedError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    fetchMock.mockImplementation(() => Promise.reject(namedError));
    await expect(submitGuess("up")).rejects.toBe(namedError);
  });

  it("classifies malformed ok responses as retryable unknown errors", async () => {
    installFetch();
    fetchMock.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const unparseable = (await getPlayer().catch(
      (thrown: unknown) => thrown,
    )) as ApiRequestError;
    expect(unparseable.code).toBe("unknown");
    expect(unparseable.category).toBe("unknown");
    expect(unparseable.retryable).toBe(true);

    fetchMock.mockResolvedValue(jsonResponse(null, 200));
    const wrongShape = (await getPlayer().catch(
      (thrown: unknown) => thrown,
    )) as ApiRequestError;
    expect(wrongShape.code).toBe("unknown");
    expect(wrongShape.retryable).toBe(true);
  });

  it("never reads document.cookie", async () => {
    let cookieReads = 0;
    vi.stubGlobal("document", {
      get cookie() {
        cookieReads += 1;
        return "btc_player=SECRET";
      },
    });
    installFetch();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(player, 201)),
    );

    await getPlayer();
    await createPlayer("Ada");
    await submitGuess("up");

    expect(cookieReads).toBe(0);
  });

  it("converts unknown thrown values to a non-retryable unknown error", () => {
    expect(toApiError(new Error("nope"))).toEqual({
      code: "unknown",
      status: null,
      category: "unknown",
      requestId: null,
      retryable: false,
    });
  });
});
