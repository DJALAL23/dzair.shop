/**
 * The hourly refresh on real D1, with each carrier's real list: a connected
 * company with no map, or a week-old one, is read again (its desks too);
 * a fresh one, an inactive one and one without credentials are left alone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { refreshCarrierPlaces, PLACES_STALE_AFTER_MS } from "./refresh-carrier-places";
import noestList from "@/carriers/test/places/noest.json";
import noestFees from "@/carriers/test/places/noest-fees.json";

let d1: TestD1;
const NOW = new Date("2026-11-08T12:00:00.000Z");
const T0 = "2026-10-01T00:00:00.000Z";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.carrierPlaces, schema.companyStopDesks, schema.deliveryCompanies]) await d1.db.delete(table);
  const noest = { nameAr: "-", provider: "noest" as const, apiToken: "t", apiUserGuid: "g", active: true, createdAt: T0, updatedAt: T0 };
  await d1.db.insert(schema.deliveryCompanies).values([
    { ...noest, id: "never", name: "Never read", code: "noest_1" },
    { ...noest, id: "stale", name: "Week old", code: "noest_2", placesSyncedAt: new Date(NOW.getTime() - PLACES_STALE_AFTER_MS - 1).toISOString() },
    { ...noest, id: "fresh", name: "Fresh", code: "noest_3", placesSyncedAt: new Date(NOW.getTime() - 60_000).toISOString() },
    { ...noest, id: "off", name: "Inactive", code: "noest_4", active: false },
    { ...noest, id: "bare", name: "No credentials", code: "noest_5", apiToken: null },
  ]);
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/get/wilayas")) return Response.json(noestList.wilayas);
    if (path.endsWith("/get/communes")) return Response.json(noestList.communes);
    if (path.endsWith("/fees")) return Response.json({ tarifs: noestFees.tarifs });
    if (path.endsWith("/desks")) return Response.json({ "16A": { code: "16A", name: "Bab Ezzouar", address: "x", phones: {} }, "3A": { code: "3A", name: "Aflou", address: "y", phones: {} } });
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = () => ({ DB: d1.raw }) as never;
const mapSize = async (id: string) => (await d1.db.select().from(schema.carrierPlaces).where(eq(schema.carrierPlaces.companyId, id)).all()).length;

describe("the hourly refresh of maps of places", () => {
  it("reads a never-read and a week-old map, and leaves the others alone", async () => {
    await refreshCarrierPlaces(env(), NOW);
    expect(await mapSize("never")).toBe(1541);
    expect(await mapSize("stale")).toBe(1541);
    for (const id of ["fresh", "off", "bare"]) expect(await mapSize(id)).toBe(0);
  });

  it("reads the company's rates with its places", async () => {
    await refreshCarrierPlaces(env(), NOW);
    const rows = await d1.db.select({ home: schema.carrierPlaces.homeRate }).from(schema.carrierPlaces).where(eq(schema.carrierPlaces.companyId, "never")).all();
    expect(rows.filter((r) => r.home != null).length).toBeGreaterThan(1500);
  });

  it("places the desks through the fresh map, in today's wilayas", async () => {
    await refreshCarrierPlaces(env(), NOW);
    const desks = await d1.db.select({ code: schema.companyStopDesks.code, communeId: schema.companyStopDesks.communeId, wilayaId: schema.companyStopDesks.wilayaId }).from(schema.companyStopDesks).where(eq(schema.companyStopDesks.companyId, "never")).all();
    expect(desks.sort((a, b) => a.code.localeCompare(b.code))).toEqual([
      { code: "16A", communeId: expect.any(String), wilayaId: 16 },
      { code: "3A", communeId: "c-03-019", wilayaId: 59 }, // NOEST files Aflou under Laghouat; shoppers find it under Aflou
    ]);
  });

  it("a carrier that cannot be read leaves that company as it was and goes on to the next", async () => {
    await d1.db.update(schema.deliveryCompanies).set({ apiToken: "down" }).where(eq(schema.deliveryCompanies.id, "never"));
    const answer = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization");
      return auth === "Bearer down" ? new Response("down", { status: 503 }) : answer(input, init);
    }) as unknown as typeof fetch;
    await refreshCarrierPlaces(env(), NOW);
    expect(await mapSize("never")).toBe(0);
    expect(await mapSize("stale")).toBe(1541);
    const never = await d1.db.select({ at: schema.deliveryCompanies.placesSyncedAt }).from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "never")).get();
    expect(never?.at).toBeNull();
  }, 60_000);
});
