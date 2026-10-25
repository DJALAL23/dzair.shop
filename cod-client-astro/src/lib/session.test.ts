import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "u1", name: "Amina", email: "amina@example.com", role: "admin" };

function respond(status: number, body: unknown = null, headers: Record<string, string> = {}) {
  return new Response(body === null ? "null" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  return import("./session");
}

/** Lets every retry wait elapse while the check runs. */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}

describe("checking the session", () => {
  it("returns the signed-in merchant", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { user, scopes: ["orders:read"] }));
    const { fetchIdentity } = await load();

    expect(await settle(fetchIdentity())).toEqual({
      value: { user: { id: "u1", name: "Amina", email: "amina@example.com", language: undefined }, role: "admin", scopes: ["orders:read"] },
    });
  });

  it("answers signed out only when the server says there is no session", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, null));
    const { fetchIdentity } = await load();
    expect(await settle(fetchIdentity())).toEqual({ value: null });

    vi.resetModules();
    fetchMock.mockResolvedValueOnce(respond(401, { message: "Unauthorized" }));
    const again = await load();
    expect(await settle(again.fetchIdentity())).toEqual({ value: null });
  });

  it("waits out a rate limit instead of signing the merchant out", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(429, { message: "Too many requests" }, { "X-Retry-After": "2" }))
      .mockResolvedValueOnce(respond(200, { user, scopes: [] }));
    const { fetchIdentity } = await load();

    const outcome = await settle(fetchIdentity());

    expect(outcome).toMatchObject({ value: { user: { id: "u1" } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a server error or a dropped connection", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(200, { user, scopes: [] }));
    const { fetchIdentity } = await load();

    expect(await settle(fetchIdentity())).toMatchObject({ value: { user: { id: "u1" } } });
  });

  it("reports a session it could not check, never a signed-out merchant, and checks again next time", async () => {
    fetchMock.mockResolvedValue(respond(429, { message: "Too many requests" }, { "X-Retry-After": "60" }));
    const { fetchIdentity, SessionUnavailableError } = await load();

    const outcome = await settle(fetchIdentity());

    expect(outcome).toMatchObject({ error: expect.any(SessionUnavailableError) });
    const calls = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue(respond(200, { user, scopes: [] }));
    expect(await settle(fetchIdentity())).toMatchObject({ value: { user: { id: "u1" } } });
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });

  it("remembers the server's answer for the page session — never a check that failed — and forgets it to check again", async () => {
    fetchMock.mockResolvedValue(respond(429, { message: "Too many requests" }, { "X-Retry-After": "60" }));
    const { fetchIdentity, knownIdentity, refreshJwt } = await load();
    expect(knownIdentity()).toBeUndefined();
    await settle(fetchIdentity());
    expect(knownIdentity()).toBeUndefined();

    fetchMock.mockResolvedValue(respond(200, { user, scopes: ["orders:read"] }));
    await settle(fetchIdentity());
    expect(knownIdentity()).toMatchObject({ user: { id: "u1" }, scopes: ["orders:read"] });

    fetchMock.mockResolvedValue(respond(200, null));
    const refreshing = refreshJwt();
    expect(knownIdentity()).toBeUndefined();
    await settle(refreshing);
    expect(knownIdentity()).toBeNull();
  });

  it("tells a watcher every answer from then on, and nothing once it stops watching", async () => {
    fetchMock.mockResolvedValue(respond(200, { user, scopes: [] }));
    const { fetchIdentity, refreshJwt, watchIdentity } = await load();
    const seen: unknown[] = [];
    const stop = watchIdentity((identity) => seen.push(identity && identity.user.id));
    await settle(fetchIdentity());
    expect(seen).toEqual(["u1"]);

    fetchMock.mockResolvedValue(respond(200, null));
    await settle(refreshJwt());
    expect(seen).toEqual(["u1", null]);

    stop();
    fetchMock.mockResolvedValue(respond(200, { user, scopes: [] }));
    await settle(refreshJwt());
    expect(seen).toEqual(["u1", null]);
  });
});
