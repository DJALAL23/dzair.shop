/**
 * The permission each action on a shipment takes is the one the shared table
 * says (`scopeForShipmentAction`, what the dashboard offers by), on the real
 * routes and real D1: with that permission alone the action is never
 * refused for permission; with every other one, it always is.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { ALL_SCOPES } from "../../../../cod-shared/rbac/scopes";
import { SHIPMENT_ACTIONS, scopeForShipmentAction, type ShipmentAction } from "../../../../cod-shared/shipments/actions";
import type { ShipmentKind } from "../../../../cod-shared/shipments/model";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0 } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let scopes: string[] = [];
const realFetch = globalThis.fetch;
const shipmentOf: Record<ShipmentKind, string> = { carrier: "", driver: "" };

const ALL: string[] = ALL_SCOPES;

/** Each action as the dashboard calls it. */
const REQUEST: Record<ShipmentAction, (id: string) => [string, string, unknown?]> = {
  validate: (id) => ["POST", `/api/shipments/${id}/validate`, {}],
  update: (id) => ["PATCH", `/api/shipments/${id}`, { customerName: "Karim B" }],
  void: (id) => ["POST", `/api/shipments/${id}/void`],
  resolve: (id) => ["POST", `/api/shipments/${id}/resolve`, { action: "release" }],
  lookup: (id) => ["POST", `/api/shipments/${id}/resolve`, { action: "lookup" }],
  addRemark: (id) => ["POST", `/api/shipments/${id}/remarks`, { content: "Call first" }],
  listRemarks: (id) => ["GET", `/api/shipments/${id}/remarks`],
  label: (id) => ["GET", `/api/shipments/${id}/label`],
  askReturn: (id) => ["POST", `/api/shipments/${id}/ask-return`],
  requestNewAttempt: (id) => ["POST", `/api/shipments/${id}/request-new-attempt`],
  confirmReturn: (id) => ["POST", `/api/shipments/${id}/confirm-return`],
  sync: (id) => ["POST", `/api/shipments/${id}/sync`],
  report: (id) => ["POST", `/api/shipments/${id}/events`, { status: "returned" }],
};

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  const commune = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await seedOrder(d1.db, commune, { id: "o-carrier" });
  await seedOrder(d1.db, commune, { id: "o-driver" });
  scopes = ALL;
  shipmentOf.carrier = ((await (await jsonRequest(app, "POST", "/api/orders/o-carrier/shipment", { kind: "carrier", companyId: "eco-manual" })).json()) as any).data.shipment.id;
  shipmentOf.driver = ((await (await jsonRequest(app, "POST", "/api/orders/o-driver/shipment", { kind: "driver", driverId: "dr1" })).json()) as any).data.shipment.id;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const cases = (["carrier", "driver"] as const).flatMap((kind) =>
  SHIPMENT_ACTIONS.filter((action) => kind === "carrier" || action === "void" || action === "report").map((action) => [kind, action] as const),
);

describe("each action on a shipment takes the permission the shared table names", () => {
  it.each(cases)("%s shipment · %s", async (kind, action) => {
    const needed = scopeForShipmentAction(action, kind);
    const [method, path, body] = REQUEST[action](shipmentOf[kind]);

    scopes = ALL.filter((scope) => scope !== needed);
    expect((await jsonRequest(app, method, path, body)).status, `without ${needed}`).toBe(403);

    scopes = [needed];
    expect((await jsonRequest(app, method, path, body)).status, `with ${needed} alone`).not.toBe(403);
  });
});
