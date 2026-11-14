import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  let jwt = "stale-jwt";
  return {
    currentJwt: vi.fn(async () => jwt),
    refreshJwt: vi.fn(async () => {
      jwt = "fresh-jwt";
      return jwt;
    }),
  };
});

vi.mock("@/lib/session", () => session);
vi.mock("astro:env/client", () => ({ PUBLIC_API_URL: "https://api.test" }));

import { apiFetch } from "./api";

describe("apiFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries a 401 with a freshly issued bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch<{ ok: boolean }>("/api/orders")).resolves.toEqual({ ok: true });

    expect(session.refreshJwt).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer stale-jwt" },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer fresh-jwt" },
    });
  });

  it("sends a member an admin turned off to sign-in, which says why, and still fails the call", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { hostname: "localhost", replace } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "User account is inactive", code: "USER_INACTIVE" }), { status: 403 })));

    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 403, code: "USER_INACTIVE" });
    expect(replace).toHaveBeenCalledWith("/sign-in?turned_off=1");
  });

  it("leaves a member who only lacks a permission where they are", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { hostname: "localhost", replace } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403 })));

    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 403 });
    expect(replace).not.toHaveBeenCalled();
  });

  it("answers nothing for a 204, which has no body to read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiFetch<void>("/api/media/uploads/m1/content", { method: "PUT" })).resolves.toBeUndefined();
  });
});
