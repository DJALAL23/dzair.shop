/**
 * Delivery companies through the real route stack onto real D1: who may do
 * what, what a response may reveal, and how a stop-desk sync treats what the
 * merchant already has.
 *
 * Staff users only — an admin passes every scope check, which would prove
 * nothing about the scopes themselves.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import deliveryCompaniesRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = [];
const realFetch = globalThis.fetch;
const NOW = () => new Date().toISOString();

const WEBHOOK_SECRET = "whsec_abcdefghij_sign";
const RELAY_SECRET = "relay-secret-value-9876";
const API_TOKEN = "yal-token-XYZ";

beforeAll(async () => {
  harness = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    c.set("user", {
      id: "staff_1",
      email: "staff@example.com",
      name: "Staff",
      role: "staff",
      status: "active",
      apiKey: "cod_staff_key",
      scopes,
    } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/delivery-companies", deliveryCompaniesRouter);
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(harness.db);
  await harness.db.delete(schema.companyStopDesks);
  await harness.db.delete(schema.deliveryCompanies);
  await harness.db.insert(schema.deliveryCompanies).values({
    id: "comp-yal",
    name: "Yalidine",
    nameAr: "ياليدين",
    code: "yalidine",
    active: true,
    apiToken: API_TOKEN,
    apiUserGuid: "yal-id",
    webhookSecret: WEBHOOK_SECRET,
    notes: JSON.stringify({ from_wilaya_name: "Batna", proxy_base_url: "https://relay.example", proxy_secret: RELAY_SECRET }),
    createdAt: NOW(),
    updatedAt: NOW(),
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const request = (method: string, path: string, body?: unknown) =>
  app.request(`/api/delivery-companies${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });

describe("what a response may reveal", () => {
  it("never returns a credential or a secret, in a list or a single company", async () => {
    scopes = ["delivery:read"];
    for (const path of ["", "/comp-yal"]) {
      const res = await request("GET", path);
      expect(res.status).toBe(200);
      const text = await res.text();
      for (const secret of [WEBHOOK_SECRET, RELAY_SECRET, API_TOKEN, "yal-id"]) expect(text).not.toContain(secret);
    }
  });

  it("still says what is configured: connected, a signing secret, the relay", async () => {
    scopes = ["delivery:read"];
    const body: any = await (await request("GET", "/comp-yal")).json();
    expect(body.data).toMatchObject({ isConnected: true, webhookSecret: "••••sign" });
    expect(body.data).not.toHaveProperty("apiToken");
    expect(body.data).not.toHaveProperty("apiUserGuid");
    expect(JSON.parse(body.data.notes)).toEqual({ from_wilaya_name: "Batna", proxy_base_url: "https://relay.example", proxy_secret: "••••9876" });
  });
});

describe("who may do what", () => {
  const NEW_COMPANY = { name: "NOEST", nameAr: "نوست", code: "noest" };

  it.each([
    ["POST", "", NEW_COMPANY],
    ["PATCH", "/comp-yal", { name: "Renamed" }],
    ["DELETE", "/comp-yal", undefined],
    ["POST", "/comp-yal/sync-stop-desks", undefined],
    ["POST", "/comp-yal/sync-geo", undefined],
    ["PATCH", "/comp-yal/webhook/secret", { secret: "x" }],
  ])("read access alone cannot %s %s", async (method, path, body) => {
    scopes = ["delivery:read"];
    globalThis.fetch = vi.fn(async () => {
      throw new Error("a refused request must never reach the carrier");
    }) as unknown as typeof fetch;
    const res = await request(method, path, body);
    expect(res.status).toBe(403);
    const row = await harness.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "comp-yal")).get();
    expect(row?.name).toBe("Yalidine");
  });

  it("each change needs its own scope", async () => {
    scopes = ["delivery:read", "delivery:update"];
    expect((await request("PATCH", "/comp-yal", { name: "Yalidine Express" })).status).toBe(200);
    expect((await request("DELETE", "/comp-yal")).status).toBe(403);
    expect((await request("POST", "", NEW_COMPANY)).status).toBe(403);

    scopes = ["delivery:create"];
    expect((await request("POST", "", NEW_COMPANY)).status).toBe(201);
  });
});

describe("stop-desk sync keeps what the merchant set", () => {
  const centers = (ids: number[]) =>
    new Response(JSON.stringify({ has_more: false, total_data: ids.length, data: ids.map((id) => ({ center_id: id, name: `Centre ${id}`, address: "", commune_name: "C", wilaya_id: 16 })) }), { status: 200 });

  const desks = async () =>
    (await harness.db.select().from(schema.companyStopDesks).where(eq(schema.companyStopDesks.companyId, "comp-yal")).all())
      .map((d) => [d.code, d.active] as const)
      .sort();

  it("adds new desks, keeps the merchant's on/off choice, removes desks the carrier dropped", async () => {
    scopes = ["delivery:manage"];
    globalThis.fetch = vi.fn(async () => centers([161, 162])) as unknown as typeof fetch;
    expect((await request("POST", "/comp-yal/sync-stop-desks")).status).toBe(200);
    expect(await desks()).toEqual([["161", true], ["162", true]]);

    await harness.db.update(schema.companyStopDesks).set({ active: false }).where(eq(schema.companyStopDesks.code, "161"));
    globalThis.fetch = vi.fn(async () => centers([161, 163])) as unknown as typeof fetch;
    const body: any = await (await request("POST", "/comp-yal/sync-stop-desks")).json();
    expect(body.data).toMatchObject({ total: 2, removed: 1 });
    expect(await desks()).toEqual([["161", false], ["163", true]]);
  });

  it("an empty list deletes nothing — it is far likelier an outage than every desk closing", async () => {
    scopes = ["delivery:manage"];
    globalThis.fetch = vi.fn(async () => centers([161, 162])) as unknown as typeof fetch;
    await request("POST", "/comp-yal/sync-stop-desks");
    globalThis.fetch = vi.fn(async () => centers([])) as unknown as typeof fetch;
    const res = await request("POST", "/comp-yal/sync-stop-desks");
    expect(res.status).toBe(200);
    expect(await desks()).toEqual([["161", true], ["162", true]]);
  });

  it("a carrier outage is an error and changes nothing", async () => {
    scopes = ["delivery:manage"];
    globalThis.fetch = vi.fn(async () => centers([161])) as unknown as typeof fetch;
    await request("POST", "/comp-yal/sync-stop-desks");
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Network connection lost.");
    }) as unknown as typeof fetch;
    const res = await request("POST", "/comp-yal/sync-stop-desks");
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).code).toBe("CARRIER_UNAVAILABLE");
    expect(await desks()).toEqual([["161", true]]);
  });

  it("calls the company's relay with its secret", async () => {
    scopes = ["delivery:manage"];
    const fetchMock = vi.fn(async () => centers([161]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await request("POST", "/comp-yal/sync-stop-desks");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://relay.example/")).toBe(true);
    expect((init.headers as Record<string, string>)["X-Proxy-Secret"]).toBe(RELAY_SECRET);
  });
});
