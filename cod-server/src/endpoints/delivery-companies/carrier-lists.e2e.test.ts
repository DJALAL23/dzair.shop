/**
 * Reading a carrier's lists on real D1 with NOEST's real list: places then
 * desks, the one reading the connect step, the company page and the hourly
 * refresh all use.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { buildCarrier } from "@/carriers/registry";
import { readCarrierLists } from "./carrier-lists";
import noestList from "@/carriers/test/places/noest.json";
import noestFees from "@/carriers/test/places/noest-fees.json";

let d1: TestD1;
const NOW = new Date("2026-11-13T12:00:00.000Z");
const T0 = "2026-10-01T00:00:00.000Z";
const realFetch = globalThis.fetch;
const DESKS = { "16A": { code: "16A", name: "Bab Ezzouar", address: "x", phones: {} } };
const COMPANY = { id: "noest", name: "NOEST", nameAr: "-", code: "noest_1", provider: "noest" as const, apiToken: "t", apiUserGuid: "g", active: true, createdAt: T0, updatedAt: T0 };

function carrierAnswers(desks: () => Response) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/get/wilayas")) return Response.json(noestList.wilayas);
    if (path.endsWith("/get/communes")) return Response.json(noestList.communes);
    if (path.endsWith("/fees")) return Response.json({ tarifs: noestFees.tarifs });
    if (path.endsWith("/desks")) return desks();
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());
beforeEach(async () => {
  for (const table of [schema.carrierPlaces, schema.companyStopDesks, schema.deliveryCompanies]) await d1.db.delete(table);
  await d1.db.insert(schema.deliveryCompanies).values(COMPANY);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const company = async () => (await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "noest")).get())!;
const count = async (table: typeof schema.carrierPlaces | typeof schema.companyStopDesks) => (await d1.db.select().from(table).where(eq(table.companyId, "noest")).all()).length;

describe("reading a carrier's lists", () => {
  it("reads its places, with their prices, then its desks placed through them", async () => {
    carrierAnswers(() => Response.json(DESKS));
    const read = await readCarrierLists(d1.db, "noest", buildCarrier(await company()), NOW);
    expect(read.places.communes).toBe(1541);
    expect(read.desks).toMatchObject({ total: 1, unplaced: 0 });
    expect(await count(schema.carrierPlaces)).toBe(1541);
    expect(await d1.db.select({ wilayaId: schema.companyStopDesks.wilayaId }).from(schema.companyStopDesks).all()).toEqual([{ wilayaId: 16 }]);
    expect((await company()).placesSyncedAt).toBe(NOW.toISOString());
  });

  it("keeps the places when the desks cannot be read, and the desks it had", async () => {
    carrierAnswers(() => Response.json(DESKS));
    await readCarrierLists(d1.db, "noest", buildCarrier(await company()), NOW);
    carrierAnswers(() => new Response("down", { status: 503 }));
    const read = await readCarrierLists(d1.db, "noest", buildCarrier(await company()), new Date(NOW.getTime() + 60_000));
    expect(read.desks).toBeNull();
    expect(read.places.communes).toBe(1541);
    expect(await count(schema.companyStopDesks)).toBe(1);
  });

  it("changes nothing when the places cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(readCarrierLists(d1.db, "noest", buildCarrier(await company()), NOW)).rejects.toThrow();
    expect(await count(schema.carrierPlaces)).toBe(0);
    expect(await count(schema.companyStopDesks)).toBe(0);
    expect((await company()).placesSyncedAt).toBeNull();
  });
});
