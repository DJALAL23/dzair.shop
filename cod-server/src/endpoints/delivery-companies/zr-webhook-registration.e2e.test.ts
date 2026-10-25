/**
 * Registering a ZR Express webhook, through the real route on real D1, with
 * ZR's API answered at the network edge: an endpoint is kept only with the
 * secret that verifies what it sends — never half-registered (unsigned
 * deliveries are refused, so an endpoint without its secret would send events
 * nobody can accept).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { signIn } from "@/test-utils/sign-in";
import * as schema from "@/db/schema";
import deliveryCompaniesRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const realFetch = globalThis.fetch;
const T0 = "2026-10-25T08:00:00.000Z";
let zr: { secret: Response | null; calls: Array<{ method: string; path: string }> };

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    signIn(c, { id: "staff_1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/delivery-companies", deliveryCompaniesRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  await d1.db.delete(schema.deliveryCompanies);
  await d1.db.insert(schema.deliveryCompanies).values({
    id: "zr", name: "ZR Express", nameAr: "-", code: "zr_express", provider: "zr_express", apiToken: "zr-key", apiUserGuid: "tenant",
    webhookEndpointId: "old-ep", webhookSecret: "old-secret", active: true, createdAt: T0, updatedAt: T0,
  });
  zr = { secret: Response.json({ secret: "whsec_new" }), calls: [] };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    const method = init?.method ?? "GET";
    zr.calls.push({ method, path: pathname });
    if (method === "POST" && pathname === "/api/v1/webhooks/endpoints") return Response.json({ id: "new-ep" });
    if (method === "GET" && pathname === "/api/v1/webhooks/endpoints/new-ep/secret") return zr.secret!;
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const register = () =>
  app.request("/api/delivery-companies/zr/webhook/register", { method: "POST", headers: { host: "api.store.test" } }, { DB: d1.raw } as never, { waitUntil() {}, passThroughOnException() {} } as never);
const company = async () => (await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "zr")).get())!;

describe("registering ZR's webhook", () => {
  it("replaces the endpoint it had and keeps the new one with its secret", async () => {
    const res = await register();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, webhookUrl: "https://api.store.test/webhooks/zr_express", endpointId: "new-ep" });
    expect(await company()).toMatchObject({ webhookEndpointId: "new-ep", webhookSecret: "whsec_new" });
    expect(zr.calls[0]).toEqual({ method: "DELETE", path: "/api/v1/webhooks/endpoints/old-ep" });
  });

  it("keeps nothing when the secret cannot be fetched: the new endpoint is undone, and the company has no webhook until registered again", async () => {
    zr.secret = new Response("forbidden", { status: 403 });
    const res = await register();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/signing secret could not be fetched.*nothing was registered/);
    expect(await company()).toMatchObject({ webhookEndpointId: null, webhookSecret: null });
    expect(zr.calls).toContainEqual({ method: "DELETE", path: "/api/v1/webhooks/endpoints/new-ep" });
  });

  it("treats an answer with no secret in it the same way", async () => {
    zr.secret = Response.json({ secret: "  " });
    expect((await register()).status).toBe(502);
    expect(await company()).toMatchObject({ webhookEndpointId: null, webhookSecret: null });
    expect(zr.calls).toContainEqual({ method: "DELETE", path: "/api/v1/webhooks/endpoints/new-ep" });
  });
});
