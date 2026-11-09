/**
 * Delivery companies through the real route stack onto real D1: who may do
 * what, what a response may reveal, and how a stop-desk sync treats what the
 * merchant already has.
 *
 * Staff users only — an admin passes every scope check, which would prove
 * nothing about the scopes themselves.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
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
const STORED_SECRET = "stored-secret-value-9876";
const API_TOKEN = "yal-token-XYZ";

beforeAll(async () => {
  harness = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    signIn(c, {
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
    provider: "yalidine",
    providerConfig: JSON.stringify({ platform: "yalidine", fromWilayaName: "Batna", apiSecret: STORED_SECRET }),
    notes: JSON.stringify({ api_password: "legacy-pass-5555" }),
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
      for (const secret of [WEBHOOK_SECRET, STORED_SECRET, API_TOKEN, "yal-id", "legacy-pass-5555"]) expect(text).not.toContain(secret);
    }
  });

  it("still says what is configured: connected, a signing secret, the settings", async () => {
    scopes = ["delivery:read"];
    const body: any = await (await request("GET", "/comp-yal")).json();
    expect(body.data).toMatchObject({ isConnected: true, webhookSecretSet: true });
    expect(body.data).not.toHaveProperty("webhookSecret");
    expect(body.data).not.toHaveProperty("apiToken");
    expect(body.data).not.toHaveProperty("apiUserGuid");
    expect(body.data.provider).toBe("yalidine");
    expect(body.data.providerConfig).toEqual({ platform: "yalidine", fromWilayaName: "Batna", apiSecret: "••••9876" });
    expect(JSON.parse(body.data.notes)).toEqual({ api_password: "••••5555" });
  });
});

describe("who may do what", () => {
  const NEW_COMPANY = { name: "NOEST", nameAr: "نوست", code: "noest" };

  it.each([
    ["POST", "", NEW_COMPANY],
    ["PATCH", "/comp-yal", { name: "Renamed" }],
    ["DELETE", "/comp-yal", undefined],
    ["POST", "/comp-yal/sync-stop-desks", undefined],
    ["POST", "/comp-yal/sync-places", undefined],
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

describe("saving carrier settings", () => {
  const stored = async () =>
    JSON.parse((await harness.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "comp-yal")).get())!.providerConfig!);

  it("changing the sender wilaya keeps the platform and leaves out a setting the adapter no longer has", async () => {
    scopes = ["delivery:update"];
    const res = await request("PATCH", "/comp-yal", { providerConfig: { fromWilayaName: "Oran" } });
    expect(res.status).toBe(200);
    expect(await stored()).toEqual({ platform: "yalidine", fromWilayaName: "Oran" });
  });

  it("refuses settings the adapter does not accept, and stores nothing", async () => {
    scopes = ["delivery:update"];
    const res = await request("PATCH", "/comp-yal", { providerConfig: { platform: "maystro" } });
    expect(res.status).toBe(400);
    expect((await stored()).platform).toBe("yalidine");
  });

  it("a new company takes the provider it is given, with the adapter's default settings", async () => {
    scopes = ["delivery:create"];
    const res = await request("POST", "", { name: "Guepex", nameAr: "قيباكس", code: "guepex", provider: "yalidine", providerConfig: { platform: "guepex" } });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.data.provider).toBe("yalidine");
    expect(body.data.providerConfig).toEqual({ platform: "guepex", fromWilayaName: "Alger" });
    expect(body.data.capabilities).toMatchObject({ updates: "pull" });
    expect(body.data.autoValidate).toBe(true);
  });

  it("a company given no provider is never guessed one from its code: it cannot take parcels", async () => {
    scopes = ["delivery:create"];
    const body: any = await (await request("POST", "", { name: "Yalidine 2", nameAr: "ياليدين", code: "yalidine_2" })).json();
    expect(body.data).toMatchObject({ provider: null, capabilities: null });
  });

  it("a carrier that locks a parcel at validation (EcoTrack, NOEST) validates by hand by default; the others validate at once", async () => {
    scopes = ["delivery:create"];
    const create = async (provider: string) =>
      ((await (await request("POST", "", { name: provider, nameAr: provider, code: `${provider}_default`, provider })).json()) as any).data.autoValidate;
    expect(await create("ecotrack")).toBe(false);
    expect(await create("noest")).toBe(false);
    expect(await create("yalidine")).toBe(true);
    expect(await create("zr_express")).toBe(true);
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

  it("calls Yalidine at its own address, even with an old setting stored", async () => {
    scopes = ["delivery:manage"];
    const fetchMock = vi.fn(async () => centers([161]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await request("POST", "/comp-yal/sync-stop-desks");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://api.yalidine.app/v1/")).toBe(true);
    expect((init.headers as Record<string, string>)["X-API-ID"]).toBe("yal-id");
  });
});
