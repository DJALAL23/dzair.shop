/**
 * The EcoTrack company seed on real D1: every seeded courier is a company the
 * EcoTrack adapter serves once the merchant adds a token, re-running the seed
 * repairs one seeded before companies named their provider, and never
 * touches what the merchant set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { ECOTRACK_COURIERS } from "../../../../cod-shared/lib/ecotrack-couriers";
import { buildCarrier } from "../registry";
import { buildAllEcotrackCompanyUpserts, ecotrackCompanyId } from "./seed-sql";

let d1: TestD1;
const seed = () => d1.raw.batch(buildAllEcotrackCompanyUpserts(ECOTRACK_COURIERS).map((sql) => d1.raw.prepare(sql)));

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.db.delete(schema.deliveryCompanies);
});

describe("the EcoTrack seed", () => {
  it("seeds every courier as an EcoTrack company that works once it has a token", async () => {
    await seed();
    const rows = await d1.db.select().from(schema.deliveryCompanies).all();
    expect(rows).toHaveLength(ECOTRACK_COURIERS.length);
    expect(rows.every((r) => r.provider === "ecotrack" && !r.active)).toBe(true);
    const [first] = rows;
    expect(buildCarrier({ ...first, apiToken: "merchant-token" }).provider).toBe("ecotrack");
  });

  it("re-running gives a company seeded without a provider its adapter, and keeps what the merchant set", async () => {
    await seed();
    const [a, b] = ECOTRACK_COURIERS.map((c) => ecotrackCompanyId(c.key));
    await d1.db.update(schema.deliveryCompanies).set({ provider: null }).where(eq(schema.deliveryCompanies.id, a));
    await d1.db.update(schema.deliveryCompanies).set({ apiToken: "merchant-token", active: true, autoValidate: true }).where(eq(schema.deliveryCompanies.id, b));
    await seed();
    expect((await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, a)).get())!.provider).toBe("ecotrack");
    expect(await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, b)).get()).toMatchObject({ apiToken: "merchant-token", active: true, autoValidate: true, provider: "ecotrack" });
  });

  it("never replaces a provider the merchant chose", async () => {
    await seed();
    const [a] = ECOTRACK_COURIERS.map((c) => ecotrackCompanyId(c.key));
    await d1.db.update(schema.deliveryCompanies).set({ provider: "noest" }).where(eq(schema.deliveryCompanies.id, a));
    await seed();
    expect((await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, a)).get())!.provider).toBe("noest");
  });
});
