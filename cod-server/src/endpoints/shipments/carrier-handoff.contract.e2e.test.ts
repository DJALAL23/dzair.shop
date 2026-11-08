/**
 * The handoff against adapters that misbehave in ways the real ones do not
 * today — so the protocol stays safe when an adapter has a bug: a parcel left
 * out of a bulk answer, or a failure that is not a classified carrier error.
 * Either way the parcel may exist, so the shipment must be kept as unknown.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { SYSTEM_ACTING } from "@/lib/acting";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import type { CarrierAdapter, CarrierShipmentInput } from "@/carriers/contract";
import { ECOTRACK_CAPABILITIES } from "@/carriers/ecotrack/adapter";
import { handOffToCarrier, type DeliveryCompanyRow } from "./carrier-handoff";

const stub = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("@/carriers/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/carriers/registry")>()),
  buildCarrier: () => stub.adapter,
}));

let d1: TestD1;
let company: DeliveryCompanyRow;
const T0 = "2026-10-14T08:00:00.000Z";

const parcelFor = (input: CarrierShipmentInput) => ({ carrierParcelId: `P-${input.reference}`, trackingNumber: `T-${input.reference}`, carrierData: null, labelUrl: null });

function adapter(over: Partial<CarrierAdapter>): CarrierAdapter {
  return {
    provider: "ecotrack",
    capabilities: { ...ECOTRACK_CAPABILITIES, separateValidation: false },
    interpret: () => ({ kind: "unknown" }),
    createShipment: async (input) => parcelFor(input),
    ...over,
  } as CarrierAdapter;
}

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [schema.shipmentEvents, schema.shipments, schema.companyApiLogs, schema.orders, schema.customers, schema.carrierPlaces, schema.deliveryCompanies]) {
    await d1.db.delete(table);
  }
  const commune = (await d1.db.select({ id: schema.communes.id }).from(schema.communes).where(eq(schema.communes.wilayaId, 16)).get())!.id;
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  await d1.db.insert(schema.orders).values(
    ["o1", "o2"].map((id) => ({
      id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: commune,
      address: "Rue 1", price: 1500, deliveryFee: 400, status: "ready" as const, createdAt: T0, updatedAt: T0,
    })),
  );
  await d1.db.insert(schema.deliveryCompanies).values({ id: "co", name: "Stub", nameAr: "-", code: "stub_ecotrack", provider: "ecotrack", apiToken: "t", apiEndpoint: "https://stub", placesSyncedAt: T0, createdAt: T0, updatedAt: T0 });
  await d1.db.insert(schema.carrierPlaces).values({ companyId: "co", communeId: commune, wilayaRef: "16", wilayaNumber: 16, wilayaName: "Alger", communeRef: "1601", communeName: "Alger Centre", home: true });
  company = (await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "co")).get())!;
});

const stateOf = async (orderId: string) => (await d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId)).get())?.handoffState;

describe("an adapter that breaks its promises", () => {
  it("a bulk answer that leaves a parcel out: that parcel is unknown, the others are recorded", async () => {
    stub.adapter = adapter({
      createShipments: async (inputs) => [{ reference: inputs[0].reference, ok: true, parcel: parcelFor(inputs[0]) }],
    });
    const results = await handOffToCarrier(d1.db, company, [{ orderId: "o1" }, { orderId: "o2" }], SYSTEM_ACTING);
    expect(results.map((r) => r.outcome)).toEqual(["accepted", "unknown"]);
    expect(await stateOf("o2")).toBe("unknown");
  });

  it("a failure that is not a carrier error: the parcel may exist, so it is unknown", async () => {
    stub.adapter = adapter({
      createShipment: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'tracking')");
      },
    });
    const [result] = await handOffToCarrier(d1.db, company, [{ orderId: "o1" }], SYSTEM_ACTING);
    expect(result).toMatchObject({ outcome: "unknown", message: expect.stringMatching(/reading 'tracking'/) });
    expect(await stateOf("o1")).toBe("unknown");
  });

  it("a bulk call that throws something unclassified leaves every parcel unknown", async () => {
    stub.adapter = adapter({
      createShipments: async () => {
        throw new Error("socket hang up");
      },
    });
    const results = await handOffToCarrier(d1.db, company, [{ orderId: "o1" }, { orderId: "o2" }], SYSTEM_ACTING);
    expect(results.map((r) => r.outcome)).toEqual(["unknown", "unknown"]);
  });
});
