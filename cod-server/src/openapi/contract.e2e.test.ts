/**
 * The published OpenAPI document is what the API answers, on real D1: an
 * order's life from creation to its settled delivery — through a carrier and
 * through the store's driver — goes through the real routes, and every
 * answer must match the document strictly (a field it does not declare is
 * drift too). And no answer, nor the document, carries a credential.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { responseErrors, type OpenApiDocument } from "@/test-utils/openapi-contract";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { yalidineCapabilities } from "@/carriers/yalidine/adapter";
import { NOEST_CAPABILITIES } from "@/carriers/noest/adapter";
import { ECOTRACK_CAPABILITIES } from "@/carriers/ecotrack/adapter";
import { registerSpecEndpoint } from "./serve";
import ordersRouter from "@/endpoints/orders/routes";
import shipmentsRouter from "@/endpoints/shipments/routes";
import deliveryCompaniesRouter from "@/endpoints/delivery-companies/routes";
import driversRouter from "@/endpoints/drivers/routes";
import driverPaymentsRouter from "@/endpoints/driver-payments/routes";
import analyticsRouter from "@/endpoints/analytics/routes";
import eventsRouter from "@/endpoints/events/routes";
import { seedOrder, seedStore, T0, type OrderSeed } from "@/endpoints/shipments/test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const WEBHOOK_SECRET = "whsec_contract_signing_secret_9f2c";
const PROXY_SECRET = "proxy-secret-7d41";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let doc: OpenApiDocument;
let server: EcotrackMockServer;
let commune16: string;
const realFetch = globalThis.fetch;
/** Every body the API answered in a test, to search for credentials. */
let answered: string[] = [];

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  registerSpecEndpoint(app);
  app.use("/api/*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "staff_1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  app.route("/api/shipments", shipmentsRouter);
  app.route("/api/delivery-companies", deliveryCompaniesRouter);
  app.route("/api/drivers", driversRouter);
  app.route("/api/driver-payments", driverPaymentsRouter);
  app.route("/api/analytics", analyticsRouter);
  app.route("/api/events", eventsRouter);
  doc = (await (await app.request("/api/openapi.json", {}, { WORKER_URL: "https://api.example.com" } as never)).json()) as OpenApiDocument;
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  answered = [];
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await d1.db.update(schema.deliveryCompanies).set({ webhookSecret: WEBHOOK_SECRET, providerConfig: JSON.stringify({ platform: "yalidine", proxySecret: PROXY_SECRET }) }).where(eq(schema.deliveryCompanies.id, "yal"));
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await d1.db.insert(schema.driverCompensations).values({ id: "comp1", driverId: "dr1", wilayaId: 16, feePerDelivery: 300, createdAt: T0, updatedAt: T0 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const seed = (s: OrderSeed) => seedOrder(d1.db, commune16, s);

/**
 * One request through the app; its answer must have the expected status and
 * match the document's schema for `template` (the path as documented).
 */
async function api(method: string, path: string, template: string, status: number, body?: unknown) {
  const init = { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) };
  const res = await app.request(path, init, undefined, { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as never);
  const text = await res.text();
  answered.push(text);
  expect(res.status, `${method} ${path}: ${text.slice(0, 400)}`).toBe(status);
  const json = JSON.parse(text);
  expect(responseErrors(doc, method, template, status, json), `${method} ${template} ${status}`).toEqual([]);
  return json;
}

describe("the document is what the API answers", () => {
  it("an order handed to a carrier, followed, voided, handed again", async () => {
    await seed({ id: "o1", status: "confirmed" });
    await api("GET", "/api/orders", "/api/orders", 200);
    await api("GET", "/api/orders/o1", "/api/orders/{id}", 200);
    await api("PATCH", "/api/orders/o1/status", "/api/orders/{id}/status", 200, { status: "ready" });

    const handed = await api("POST", "/api/orders/o1/shipment", "/api/orders/{id}/shipment", 201, { kind: "carrier", companyId: "eco-manual" });
    const shipmentId = handed.data.shipment.id;
    await api("GET", `/api/shipments/${shipmentId}`, "/api/shipments/{id}", 200);
    await api("GET", "/api/orders/o1", "/api/orders/{id}", 200);
    await api("GET", "/api/orders?stage=ready_to_ship", "/api/orders", 200);
    await api("POST", `/api/shipments/${shipmentId}/sync`, "/api/shipments/{id}/sync", 200);
    await api("POST", `/api/shipments/${shipmentId}/void`, "/api/shipments/{id}/void", 200);
    const again = await api("POST", "/api/orders/o1/shipment", "/api/orders/{id}/shipment", 201, { kind: "carrier", companyId: "eco-manual" });
    await api("POST", `/api/shipments/${again.data.shipment.id}/validate`, "/api/shipments/{id}/validate", 200, {});
    await api("POST", "/api/orders/o1/shipment", "/api/orders/{id}/shipment", 409, { kind: "carrier", companyId: "eco" });
    const newest = await api("GET", "/api/events?orderId=o1", "/api/events", 200);
    expect(newest.data.map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining(["order.ready", "shipment.handed_off", "shipment.voided"]));
  });

  it("a carrier that does not confirm, then resolved", async () => {
    await seed({ id: "o1" });
    server.override("/api/v1/create/order", () => new Response("{}", { status: 500 }));
    const unknown = await api("POST", "/api/orders/o1/shipment", "/api/orders/{id}/shipment", 202, { kind: "carrier", companyId: "eco" });
    server.restore("/api/v1/create/order");
    await api("POST", `/api/shipments/${unknown.data.shipment.id}/resolve`, "/api/shipments/{id}/resolve", 200, { action: "release" });
  });

  it("many orders at once, to a carrier and to the driver", async () => {
    for (const id of ["o1", "o2", "o3", "o4"]) await seed({ id });
    await api("POST", "/api/shipments/bulk", "/api/shipments/bulk", 200, { companyId: "eco", orderIds: ["o1", "o2", "missing"] });
    await api("POST", "/api/shipments/driver-bulk", "/api/shipments/driver-bulk", 200, { driverId: "dr1", orderIds: ["o3", "o4", "o1"] });
  });

  it("the driver's delivery, its settlement, the driver and the counts", async () => {
    await seed({ id: "o1" });
    const handed = await api("POST", "/api/orders/o1/shipment", "/api/orders/{id}/shipment", 201, { kind: "driver", driverId: "dr1" });
    const shipmentId = handed.data.shipment.id;
    await api("POST", `/api/shipments/${shipmentId}/events`, "/api/shipments/{id}/events", 200, { status: "out_for_delivery" });
    await api("POST", `/api/shipments/${shipmentId}/events`, "/api/shipments/{id}/events", 200, { status: "delivered" });
    await api("GET", "/api/orders/o1", "/api/orders/{id}", 200);
    await api("GET", "/api/driver-payments/dr1/pending", "/api/driver-payments/{driverId}/pending", 200);
    await api("POST", "/api/driver-payments", "/api/driver-payments", 201, { driverId: "dr1", type: "net_settlement", shipmentIds: [shipmentId] });
    await api("POST", "/api/driver-payments", "/api/driver-payments", 422, { driverId: "dr1", type: "cod_remittance", shipmentIds: [shipmentId] });
    await api("GET", "/api/driver-payments/dr1", "/api/driver-payments/{driverId}", 200);
    await api("GET", "/api/drivers/dr1", "/api/drivers/{id}", 200);
    await api("GET", "/api/analytics/order-stages", "/api/analytics/order-stages", 200);
    const log = await api("GET", "/api/events?orderId=o1&after=0", "/api/events", 200);
    expect(log.data.map((event: { type: string }) => event.type)).toEqual(["shipment.handed_off", "shipment.out_for_delivery", "shipment.delivered"]);
    await api("GET", `/api/events/${log.data[2].id}`, "/api/events/{id}", 200);
    await api("GET", "/api/events/evt_missing", "/api/events/{id}", 404);
    await api("GET", "/api/events?type=order.everything", "/api/events", 400);
  });

  it("the delivery companies, what their carriers can do, their settings and their inbox", async () => {
    const list = (await api("GET", "/api/delivery-companies", "/api/delivery-companies", 200)).data;
    const capabilities = (id: string) => list.find((c: any) => c.id === id).capabilities;
    expect(capabilities("yal")).toEqual(yalidineCapabilities("yalidine"));
    expect(capabilities("noest")).toEqual(NOEST_CAPABILITIES);
    expect(capabilities("eco")).toEqual(ECOTRACK_CAPABILITIES);
    await api("GET", "/api/delivery-companies/yal", "/api/delivery-companies/{id}", 200);
    const created = await api("POST", "/api/delivery-companies", "/api/delivery-companies", 201, {
      name: "Guepex", nameAr: "-", code: "guepex", provider: "yalidine", apiToken: "guepex-token-1234", apiUserGuid: "guepex-id-5678",
      providerConfig: { platform: "guepex", proxySecret: "guepex-proxy-0042" },
    });
    expect(created.data.capabilities).toEqual(yalidineCapabilities("guepex"));
    await api("PATCH", `/api/delivery-companies/${created.data.id}`, "/api/delivery-companies/{id}", 200, { apiToken: "guepex-token-9999" });
    await api("GET", "/api/delivery-companies/yal/webhook/events", "/api/delivery-companies/{id}/webhook/events", 200);
  });
});

describe("no credential leaves the server", () => {
  const credentials = [WEBHOOK_SECRET, PROXY_SECRET, "yal-token", "yal-id", "zr-key", "noest-token", "noest-guid", "guepex-token-1234", "guepex-token-9999", "guepex-id-5678", "guepex-proxy-0042"];

  it("in any answer about the companies", async () => {
    await api("GET", "/api/delivery-companies", "/api/delivery-companies", 200);
    await api("GET", "/api/delivery-companies/yal", "/api/delivery-companies/{id}", 200);
    const created = await api("POST", "/api/delivery-companies", "/api/delivery-companies", 201, {
      name: "Guepex", nameAr: "-", code: "guepex", provider: "yalidine", apiToken: "guepex-token-1234", apiUserGuid: "guepex-id-5678",
      providerConfig: { platform: "guepex", proxySecret: "guepex-proxy-0042" },
    });
    await api("PATCH", `/api/delivery-companies/${created.data.id}`, "/api/delivery-companies/{id}", 200, { apiToken: "guepex-token-9999" });
    const all = answered.join("\n");
    for (const secret of [...credentials, server.token]) expect(all, secret).not.toContain(secret);
    const yal = (await api("GET", "/api/delivery-companies/yal", "/api/delivery-companies/{id}", 200)).data;
    expect(yal).toMatchObject({ isConnected: true, webhookSecretSet: true });
    expect(yal.providerConfig.proxySecret).toBe(`••••${PROXY_SECRET.slice(-4)}`);
    expect((await api("GET", "/api/delivery-companies/zr", "/api/delivery-companies/{id}", 200)).data.webhookSecretSet).toBe(false);
  });

  it("nor does the document describe one: a response field named like a credential is a yes/no", () => {
    const credentialName = /secret|token|password|api.?key|guid/i;
    const found: string[] = [];
    const visit = (node: any, at: string) => {
      if (!node || typeof node !== "object") return;
      if (node.properties) {
        for (const [key, value] of Object.entries<any>(node.properties)) {
          if (credentialName.test(key) && value.type !== "boolean") found.push(`${at}.${key}`);
          visit(value, `${at}.${key}`);
        }
      }
      for (const key of ["items", "additionalProperties"]) visit(node[key], at);
      for (const key of ["anyOf", "oneOf", "allOf"]) (node[key] ?? []).forEach((s: unknown) => visit(s, at));
    };
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) visit(response.content?.["application/json"]?.schema, `${method.toUpperCase()} ${path} ${status}`);
      }
    }
    for (const [name, component] of Object.entries(doc.components?.schemas ?? {})) visit(component, name);
    expect(found).toEqual([]);
  });
});
