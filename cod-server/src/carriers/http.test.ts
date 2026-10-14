import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CarrierError } from "./contract";
import { createCarrierHttp, flattenErrorBag } from "./http";

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const http = () =>
  createCarrierHttp({
    provider: "yalidine",
    baseUrl: "https://carrier.test/v1/",
    headers: () => ({ "X-Key": "k" }),
    describeError: (_status, json) => (json as { message?: string }).message ?? null,
    timeoutMs: 50,
  });

const respond = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

async function failure(promise: Promise<unknown>): Promise<CarrierError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CarrierError);
    return error as CarrierError;
  }
  throw new Error("expected a CarrierError");
}

describe("carrier HTTP — success", () => {
  it("joins base URL and path, sends headers and JSON body, parses the answer", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, '{"ok":1}'));
    await expect(http().write("POST", "/parcels/", [{ a: 1 }])).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://carrier.test/v1/parcels/");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-Key": "k" });
    expect(init.body).toBe('[{"a":1}]');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats an empty success body as an empty object (204-style answers)", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, ""));
    await expect(http().write("PATCH", "/x")).resolves.toEqual({});
  });
});

describe("carrier HTTP — what a failure means", () => {
  it.each([
    [400, '{"message":"bad phone"}', "rejected"],
    [404, '{"message":"not found"}', "rejected"],
    [422, '{"message":"invalid"}', "rejected"],
    [401, '{"message":"wrong token"}', "auth"],
    [403, '{"error":{"message":"forbidden"}}', "auth"],
  ] as const)("HTTP %i with a JSON body is %s, read or write", async (status, body, kind) => {
    for (const method of ["read", "write"] as const) {
      fetchMock.mockResolvedValueOnce(respond(status, body));
      const error = await failure(http()[method]("POST", "/x"));
      expect(error.kind).toBe(kind);
      expect(error.httpStatus).toBe(status);
      expect(error.provider).toBe("yalidine");
    }
  });

  it("keeps the carrier's message", async () => {
    fetchMock.mockResolvedValueOnce(respond(422, '{"message":"commune inconnue"}'));
    expect((await failure(http().write("POST", "/x"))).message).toContain("commune inconnue");
  });

  it("429 is rate limited and carries Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(respond(429, '{"message":"Too Many Attempts."}', { "retry-after": "17" }));
    const error = await failure(http().write("POST", "/x"));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSec).toBe(17);
  });

  it("an HTML block page never reached the carrier: unavailable, even for a write", async () => {
    fetchMock.mockResolvedValueOnce(respond(403, "<html>error code: 1106</html>"));
    const error = await failure(http().write("POST", "/x"));
    expect(error.kind).toBe("unavailable");
    expect(error.message).toContain("1106");
  });

  it("a server error on a write may have happened: ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(respond(500, '{"message":"oops"}'));
    expect((await failure(http().write("POST", "/x"))).kind).toBe("ambiguous");
  });

  it("a dropped connection on a write is ambiguous", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network connection lost."));
    expect((await failure(http().write("POST", "/x"))).kind).toBe("ambiguous");
  });

  it("a timeout on a write is ambiguous", async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const error = await failure(http().write("POST", "/x"));
    expect(error.kind).toBe("ambiguous");
    expect(error.message).toContain("timed out");
  });

  it("an unreadable success on a write is ambiguous — the carrier may have created it", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, "<html>ok</html>"));
    expect((await failure(http().write("POST", "/x"))).kind).toBe("ambiguous");
  });
});

describe("carrier HTTP — reads retry once, writes never", () => {
  it("a read that fails then succeeds returns the second answer", async () => {
    fetchMock.mockResolvedValueOnce(respond(503, "{}")).mockResolvedValueOnce(respond(200, '{"v":2}'));
    await expect(http().read("GET", "/x")).resolves.toEqual({ v: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a read that fails twice is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("down"));
    expect((await failure(http().read("GET", "/x"))).kind).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a read refused by the carrier is not retried", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, '{"message":"no"}'));
    expect((await failure(http().read("GET", "/x"))).kind).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a write is never retried", async () => {
    fetchMock.mockResolvedValueOnce(respond(503, "{}"));
    await failure(http().write("POST", "/x"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("flattenErrorBag", () => {
  it("reads both carrier error-bag shapes", () => {
    expect(flattenErrorBag([{ description: "Name is required" }, "x"])).toBe("Name is required | x");
    expect(flattenErrorBag({ phone: ["invalid"], commune: "missing" })).toBe("phone: invalid | commune: missing");
    expect(flattenErrorBag(null)).toBeNull();
    expect(flattenErrorBag([])).toBeNull();
    expect(flattenErrorBag({})).toBeNull();
  });
});
