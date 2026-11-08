/**
 * A delivery company's map of places on real D1: built from the carrier's
 * list, replaced whole, summarised for the dashboard, and the way stop desks
 * find their commune.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import {
  carrierPlacesOf,
  carrierPlacesSummary,
  carrierRatesByWilaya,
  communeOfCarrierRef,
  costAt,
  placeStopDesks,
  syncCarrierPlaces,
  type CarrierPlace,
  type CarrierRate,
} from "./places";

let d1: TestD1;
const T0 = "2026-11-08T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.carrierPlaces);
  await d1.db.delete(schema.deliveryCompanies);
  await d1.db.insert(schema.deliveryCompanies).values({ id: "zr", name: "ZR", nameAr: "-", code: "zr_express", provider: "zr_express", createdAt: T0, updatedAt: T0 });
});

const NO_PRICE: CarrierRate = { home: null, stopDesk: null, homeReturn: null, stopDeskReturn: null };
const zr = (wilaya: [string, number, string], commune: [string, string], home = true, rate = NO_PRICE): CarrierPlace => ({
  wilaya: { ref: wilaya[0], number: wilaya[1], name: wilaya[2] },
  commune: { ref: commune[0], name: commune[1] },
  home,
  rate,
});
const priced = (home: number | null, stopDesk: number | null, returnFee: number | null, stopDeskReturn = returnFee): CarrierRate => ({ home, stopDesk, homeReturn: returnFee, stopDeskReturn });
const OULED_DJELLAL: [string, number, string] = ["city-51", 51, "Ouled Djellal"];
const LAGHOUAT: [string, number, string] = ["city-03", 3, "Laghouat"];

describe("syncCarrierPlaces", () => {
  it("maps each carrier place to one commune of ours, under the carrier's own ids", async () => {
    const result = await syncCarrierPlaces(d1.db, "zr", [zr(OULED_DJELLAL, ["d-besbes", "Besbes"]), zr(LAGHOUAT, ["d-aflou", "Aflou"], false)], new Date(T0));
    expect(result).toEqual({ syncedAt: T0, communes: 2, home: 1, priced: 0, unmatched: [] });
    const places = await carrierPlacesOf(d1.db, "zr", ["c-07-007", "c-03-019", "c-16-001"]);
    expect([...places.keys()].sort()).toEqual(["c-03-019", "c-07-007"]);
    expect(places.get("c-07-007")).toEqual({
      communeId: "c-07-007",
      wilaya: { ref: "city-51", number: 51, name: "Ouled Djellal" },
      commune: { ref: "d-besbes", name: "Besbes" },
      home: true,
      rate: NO_PRICE,
    });
    expect(places.get("c-03-019")?.home).toBe(false);
  });

  it("reports a place no commune of ours has the spelling of, and a second place for one commune, never storing either", async () => {
    const result = await syncCarrierPlaces(d1.db, "zr", [
      zr(OULED_DJELLAL, ["d-besbes", "Besbes"]),
      zr(OULED_DJELLAL, ["d-besbes-2", "Besbes"]),
      zr(OULED_DJELLAL, ["d-x", "Nowhere"]),
      zr(["city-16", 16, "Alger"], ["d-y", "Besbes"]), // Besbes is not in Alger
    ]);
    expect(result.communes).toBe(1);
    expect(result.unmatched).toEqual([
      { wilaya: "Ouled Djellal", commune: "Besbes" },
      { wilaya: "Ouled Djellal", commune: "Nowhere" },
      { wilaya: "Alger", commune: "Besbes" },
    ]);
    expect(await communeOfCarrierRef(d1.db, "zr", "d-besbes")).toBe("c-07-007");
    expect(await communeOfCarrierRef(d1.db, "zr", "d-y")).toBeNull();
  });

  it("replaces the whole map: a commune the carrier no longer lists is no longer served", async () => {
    await syncCarrierPlaces(d1.db, "zr", [zr(OULED_DJELLAL, ["d-besbes", "Besbes"]), zr(LAGHOUAT, ["d-aflou", "Aflou"])]);
    await syncCarrierPlaces(d1.db, "zr", [zr(LAGHOUAT, ["d-aflou-new", "Aflou"])]);
    const places = await carrierPlacesOf(d1.db, "zr", ["c-07-007", "c-03-019"]);
    expect([...places.keys()]).toEqual(["c-03-019"]);
    expect(places.get("c-03-019")?.commune.ref).toBe("d-aflou-new");
  });

  it("holds a carrier's whole list in one sync, past D1's bound-parameter limit", async () => {
    const many = Array.from({ length: 300 }, (_, i) => zr(OULED_DJELLAL, [`d-${i}`, i === 0 ? "Besbes" : `Unknown ${i}`]));
    const result = await syncCarrierPlaces(d1.db, "zr", many);
    expect(result.communes).toBe(1);
    expect(result.unmatched).toHaveLength(299);
  });

  it("goes with its company", async () => {
    await syncCarrierPlaces(d1.db, "zr", [zr(OULED_DJELLAL, ["d-besbes", "Besbes"])]);
    await d1.db.delete(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "zr"));
    expect(await d1.db.select().from(schema.carrierPlaces).all()).toEqual([]);
  });
});

describe("carrierPlacesSummary", () => {
  it("says a map that was never read is empty and when it was read", async () => {
    expect(await carrierPlacesSummary(d1.db, "zr")).toEqual({ syncedAt: null, communes: 0, home: 0, priced: 0, total: 1541, unmatched: [] });
    await syncCarrierPlaces(
      d1.db,
      "zr",
      [zr(OULED_DJELLAL, ["d-besbes", "Besbes"], true, priced(null, 400, 200)), zr(LAGHOUAT, ["d-aflou", "Aflou"], false), zr(LAGHOUAT, ["d-z", "Zzz"])],
      new Date(T0),
    );
    expect(await carrierPlacesSummary(d1.db, "zr")).toEqual({ syncedAt: T0, communes: 2, home: 1, priced: 1, total: 1541, unmatched: [{ wilaya: "Laghouat", commune: "Zzz" }] });
  });
});

describe("carrier rates on the map", () => {
  it("keeps each commune's rate as the carrier stated it, and counts the communes it prices", async () => {
    const result = await syncCarrierPlaces(d1.db, "zr", [
      zr(OULED_DJELLAL, ["d-besbes", "Besbes"], true, priced(700, 450, 200)),
      zr(LAGHOUAT, ["d-aflou", "Aflou"], true, priced(800, null, 0)),
      zr(LAGHOUAT, ["d-laghouat", "Laghouat"]),
    ]);
    expect(result.priced).toBe(2);
    const places = await carrierPlacesOf(d1.db, "zr", ["c-07-007", "c-03-019", "c-03-001"]);
    expect(places.get("c-07-007")?.rate).toEqual(priced(700, 450, 200));
    expect(places.get("c-03-019")?.rate).toEqual({ home: 800, stopDesk: null, homeReturn: 0, stopDeskReturn: 0 });
    expect(places.get("c-03-001")?.rate).toEqual(NO_PRICE);
  });

  it("costs a parcel by how it is sent: the rate and the return fee for that delivery type", async () => {
    await syncCarrierPlaces(d1.db, "zr", [zr(OULED_DJELLAL, ["d-besbes", "Besbes"], true, priced(700, 450, 250, 150))]);
    const besbes = (await carrierPlacesOf(d1.db, "zr", ["c-07-007"])).get("c-07-007")!;
    expect(costAt(besbes, "home")).toEqual({ shippingCost: 700, returnFee: 250 });
    expect(costAt(besbes, "stop_desk")).toEqual({ shippingCost: 450, returnFee: 150 });
  });

  it("gives the rates by our wilaya of today: a moved commune's price is under its new wilaya, a range when communes differ", async () => {
    await syncCarrierPlaces(d1.db, "zr", [
      zr(LAGHOUAT, ["d-aflou", "Aflou"], true, priced(900, 500, 200)), // in Aflou (59) since 2026
      zr(LAGHOUAT, ["d-laghouat", "Laghouat"], true, priced(650, 400, 200)),
      zr(LAGHOUAT, ["d-ksar", "Ksar El Hirane"], true, priced(700, null, 250)),
      zr(OULED_DJELLAL, ["d-besbes", "Besbes"]),
    ]);
    expect(await carrierRatesByWilaya(d1.db, "zr")).toEqual([
      { wilayaId: 3, communes: 2, home: { min: 650, max: 700 }, stopDesk: { min: 400, max: 400 }, returnFee: { min: 200, max: 250 } },
      { wilayaId: 51, communes: 1, home: null, stopDesk: null, returnFee: null },
      { wilayaId: 59, communes: 1, home: { min: 900, max: 900 }, stopDesk: { min: 500, max: 500 }, returnFee: { min: 200, max: 200 } },
    ]);
  });
});

describe("placeStopDesks", () => {
  it("places a desk by the carrier's commune id, or by its commune's name under its wilaya, in our wilaya of today", async () => {
    await syncCarrierPlaces(d1.db, "zr", [zr(LAGHOUAT, ["d-aflou", "Aflou"])]);
    expect(
      await placeStopDesks(d1.db, "zr", [
        { communeRef: "d-aflou", commune: null, name: "Hub Aflou", wilayaNumber: null }, // ZR: a hub's district
        { communeRef: null, commune: "Besbes", name: "Centre Besbes", wilayaNumber: 7 }, // a carrier on the 1984 map
        { communeRef: null, commune: "Bordj Bou Arreridj «Ras El Oued»", name: "Ras El Oued", wilayaNumber: 34 }, // NOEST, live: free-text commune, the town as name
        { communeRef: null, commune: "Besbes", name: "Besbes", wilayaNumber: 16 }, // not in Alger
        { communeRef: "d-unknown", commune: null, name: "Somewhere", wilayaNumber: 3 },
      ]),
    ).toEqual([
      { communeId: "c-03-019", wilayaId: 59 },
      { communeId: "c-07-007", wilayaId: 51 },
      { communeId: "c-34-002", wilayaId: 34 },
      { communeId: null, wilayaId: null },
      { communeId: null, wilayaId: null },
    ]);
  });
});
