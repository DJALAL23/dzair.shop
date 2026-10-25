/**
 * Saving an EcoTrack company's credentials through the real route stack onto
 * real D1, with the real adapter talking HTTP to an EcoTrack double.
 *
 * What is proved: a token the carrier refuses is never stored as a connection;
 * a company is only checked when its credentials or connection change; a
 * carrier that cannot be reached is told apart from a refused token; and an
 * EcoTrack company is born with manual validation.
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
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import deliveryCompaniesRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
const realFetch = globalThis.fetch;
const TOKEN = "good-token";
const VALIDATE = "/api/v1/validate/token";

beforeAll(async () => {
  harness = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    signIn(c, { id: "staff_1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes: Object.values(SCOPES) } as never);
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
  await harness.db.delete(schema.deliveryCompanies);
  server = createEcotrackMockServer({ token: TOKEN });
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const send = (method: string, path: string, body: unknown) =>
  app.request(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const newCompany = (over: Record<string, unknown> = {}) => ({
  name: "Packers",
  nameAr: "باكرز",
  code: "packers_ecotrack",
  provider: "ecotrack",
  apiEndpoint: server.baseUrl,
  apiToken: TOKEN,
  active: true,
  ...over,
});

const rows = () => harness.db.select().from(schema.deliveryCompanies).all();

async function seedCompany(over: Partial<typeof schema.deliveryCompanies.$inferInsert> = {}) {
  const now = new Date().toISOString();
  await harness.db.insert(schema.deliveryCompanies).values({
    id: "eco1", name: "Packers", nameAr: "باكرز", code: "packers_ecotrack", provider: "ecotrack", active: true, autoValidate: false,
    apiEndpoint: server.baseUrl, apiToken: TOKEN, createdAt: now, updatedAt: now, ...over,
  });
}

describe("connecting an EcoTrack company", () => {
  it("stores a token the carrier accepts, and starts with manual validation", async () => {
    const res = await send("POST", "/api/delivery-companies", newCompany());
    expect(res.status).toBe(201);
    expect(server.callsFor(VALIDATE)).toHaveLength(1);
    expect(server.callsFor(VALIDATE)[0].searchParams.get("api_token")).toBe(TOKEN);
    const [row] = await rows();
    expect(row).toMatchObject({ provider: "ecotrack", active: true, autoValidate: false });
  });

  it("refuses a token the carrier rejects: nothing is stored, and the reason is the token", async () => {
    const res = await send("POST", "/api/delivery-companies", newCompany({ apiToken: "typo" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("CARRIER_AUTH_FAILED");
    expect(await rows()).toHaveLength(0);
  });

  it("refuses to connect when the carrier cannot be reached, and says it is not the token", async () => {
    server.override(VALIDATE, () => new Response("down", { status: 503 }));
    const res = await send("POST", "/api/delivery-companies", newCompany());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("CARRIER_UNAVAILABLE");
    expect(await rows()).toHaveLength(0);
  });

  it("does not call the carrier for a company saved inactive", async () => {
    const res = await send("POST", "/api/delivery-companies", newCompany({ active: false, apiToken: "typo" }));
    expect(res.status).toBe(201);
    expect(server.requests).toHaveLength(0);
  });

  it("a company saved without a token is simply not connected yet: nothing to check", async () => {
    const res = await send("POST", "/api/delivery-companies", newCompany({ apiToken: undefined }));
    expect(res.status).toBe(201);
    expect(server.requests).toHaveLength(0);
  });

  it("an explicit autoValidate choice is kept", async () => {
    await send("POST", "/api/delivery-companies", newCompany({ autoValidate: true }));
    expect((await rows())[0].autoValidate).toBe(true);
  });

  it("does not check a carrier whose adapter cannot verify a token", async () => {
    const res = await send("POST", "/api/delivery-companies", { name: "Yalidine", nameAr: "ياليدين", code: "yalidine", provider: "yalidine", apiToken: "x", apiUserGuid: "g", active: true });
    expect(res.status).toBe(201);
    expect(server.callsFor(VALIDATE)).toHaveLength(0);
  });
});

describe("connecting a NOEST company", () => {
  const noest = { name: "NOEST", nameAr: "نوست", code: "noest", provider: "noest", apiToken: "noest-token", apiUserGuid: "guid-1", active: true };

  it("stores credentials NOEST accepts, with manual validation", async () => {
    globalThis.fetch = (async () => Response.json({ message: "invalid", errors: { client: ["required"] } }, { status: 422 })) as typeof fetch;
    const res = await send("POST", "/api/delivery-companies", noest);
    expect(res.status).toBe(201);
    expect((await rows())[0]).toMatchObject({ provider: "noest", autoValidate: false });
  });

  it("refuses a refused token, or an unknown partner GUID, storing nothing", async () => {
    globalThis.fetch = (async () => Response.json({ error: "Unauthenticated." }, { status: 401 })) as typeof fetch;
    expect((await send("POST", "/api/delivery-companies", noest)).status).toBe(409);
    globalThis.fetch = (async () => Response.json({ success: false, message: "Partenaire introuvable" }, { status: 404 })) as typeof fetch;
    expect((await send("POST", "/api/delivery-companies", noest)).status).toBe(409);
    expect(await rows()).toHaveLength(0);
  });
});

describe("place names are mapped as part of connecting", () => {
  const mapped = () => harness.db.select().from(schema.carrierCommunes).all();

  it("builds the carrier's commune map when the credentials are accepted — nothing for the merchant to run", async () => {
    await harness.db.delete(schema.carrierCommunes);
    expect((await send("POST", "/api/delivery-companies", newCompany())).status).toBe(201);
    const rows = await mapped();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.carrierCode))).toEqual(new Set(["packers_ecotrack"]));
    expect(server.callsFor("/api/v1/get/communes")).toHaveLength(1);
  });

  it("builds it again when the credentials change", async () => {
    await seedCompany({ apiToken: "old" });
    await harness.db.delete(schema.carrierCommunes);
    expect((await send("PATCH", "/api/delivery-companies/eco1", { apiToken: TOKEN, active: true })).status).toBe(200);
    expect((await mapped()).length).toBeGreaterThan(0);
  });

  it("a failure while mapping never stops the company being saved", async () => {
    await harness.db.delete(schema.carrierCommunes);
    server.override("/api/v1/get/communes", () => new Response("down", { status: 503 }));
    expect((await send("POST", "/api/delivery-companies", newCompany())).status).toBe(201);
    expect((await rows())[0].active).toBe(true);
    expect(await mapped()).toHaveLength(0);
  });

  it("does not map for an edit that touches no credential", async () => {
    await seedCompany();
    await harness.db.delete(schema.carrierCommunes);
    await send("PATCH", "/api/delivery-companies/eco1", { name: "Packers Algérie" });
    expect(server.requests).toHaveLength(0);
    expect(await mapped()).toHaveLength(0);
  });
});

describe("changing an EcoTrack company's credentials", () => {
  it("keeps the stored token when the new one is refused", async () => {
    await seedCompany();
    const res = await send("PATCH", "/api/delivery-companies/eco1", { apiToken: "typo", active: true });
    expect(res.status).toBe(409);
    expect((await rows())[0].apiToken).toBe(TOKEN);
  });

  it("saves a new token the carrier accepts", async () => {
    await seedCompany({ apiToken: "old" });
    const res = await send("PATCH", "/api/delivery-companies/eco1", { apiToken: TOKEN, active: true });
    expect(res.status).toBe(200);
    expect((await rows())[0].apiToken).toBe(TOKEN);
  });

  it("checks a new host with the stored token", async () => {
    await seedCompany();
    const res = await send("PATCH", "/api/delivery-companies/eco1", { apiEndpoint: `${server.baseUrl}/` });
    expect(res.status).toBe(200);
    expect(server.callsFor(VALIDATE)).toHaveLength(1);
  });

  it("does not call the carrier for edits that touch no credential", async () => {
    await seedCompany();
    expect((await send("PATCH", "/api/delivery-companies/eco1", { name: "Packers Algérie", autoValidate: true })).status).toBe(200);
    expect(server.requests).toHaveLength(0);
  });

  it("disconnecting never needs the carrier", async () => {
    await seedCompany();
    server.override(VALIDATE, () => new Response("down", { status: 503 }));
    expect((await send("PATCH", "/api/delivery-companies/eco1", { active: false })).status).toBe(200);
    expect((await rows())[0].active).toBe(false);
  });

  it("checks the credentials again when a disconnected company is switched back on", async () => {
    await seedCompany({ active: false, apiToken: "typo" });
    expect((await send("PATCH", "/api/delivery-companies/eco1", { active: true })).status).toBe(409);
    expect((await rows())[0].active).toBe(false);
  });
});
