/**
 * The Meta App through the API, on real D1: who may see and set it up, that
 * everything the merchant typed reaches the database, and that the access
 * token never comes back.
 *
 * A route's body schema strips unknown keys before the handler runs, so a
 * field the screen sends but the route does not declare is dropped with a
 * 200. That hid a real bug — the per-page tracking switch came back off after
 * every save — so these assert what landed in the row, not what was answered.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";
import appsRouter from "./routes";

let d1: TestD1;
let admin: Api;
const T = "2026-10-26T08:00:00.000Z";
const as = (scopes: string[]) => apiAs(d1, staff(scopes), { "/api/apps": appsRouter });

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, { "/api/apps": appsRouter });
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.storePixelConfig);
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

const VALID = { pixelId: "1234567890", accessToken: "EAAG-real-token", conversionEvent: "Purchase" };

const save = (body: Record<string, unknown>) => admin.put("/api/apps/meta", body);
const storedRow = () => d1.db.select().from(schema.storePixelConfig).get();

describe("who may see and set up Meta", () => {
  it("takes meta:read to see it and meta:manage to change it", async () => {
    expect((await as(["orders:read"]).get("/api/apps/meta")).status).toBe(403);
    expect((await as(["meta:read"]).get("/api/apps/meta")).status).toBe(200);
    expect((await as(["meta:read"]).put("/api/apps/meta", VALID)).status).toBe(403);
    expect((await as(["meta:manage"]).put("/api/apps/meta", VALID)).status).toBe(200);
  });
});

describe("Meta's setup", () => {
  it("is null before it is set up", async () => {
    expect((await admin.get("/api/apps/meta")).body.data).toBeNull();
  });

  it("stores every field the merchant typed", async () => {
    const { status } = await save({ ...VALID, adAccountName: "Zinc Ads", testMode: true, testEventCode: "TEST123", conversionEvent: "Purchase_Delivered", perPageTrackingEnabled: true });
    expect(status).toBe(200);
    expect(await storedRow()).toMatchObject({
      pixelId: "1234567890",
      accessToken: "EAAG-real-token",
      adAccountName: "Zinc Ads",
      testMode: true,
      testEventCode: "TEST123",
      conversionEvent: "Purchase_Delivered",
      perPageTrackingEnabled: true,
    });
  });

  it("accepts Lead as the conversion", async () => {
    expect((await save({ ...VALID, conversionEvent: "Lead" })).body.data.conversionEvent).toBe("Lead");
  });

  it("reads the per-page tracking switch back as it was saved, and turns it off again", async () => {
    await save({ ...VALID, perPageTrackingEnabled: true });
    expect((await admin.get("/api/apps/meta")).body.data.perPageTrackingEnabled).toBe(true);
    await save({ ...VALID, perPageTrackingEnabled: false });
    expect((await storedRow())?.perPageTrackingEnabled).toBe(false);
  });

  it("keeps the per-page switch when an unrelated setting is edited", async () => {
    await save({ ...VALID, perPageTrackingEnabled: true });
    await save({ ...VALID, adAccountName: "Renamed" });
    expect((await storedRow())?.perPageTrackingEnabled).toBe(true);
  });

  it("starts with per-page tracking off", async () => {
    await save(VALID);
    expect((await storedRow())?.perPageTrackingEnabled).toBe(false);
  });

  it("never returns the access token", async () => {
    const saved = await save(VALID);
    const read = await admin.get("/api/apps/meta");
    for (const answer of [saved, read]) {
      expect(JSON.stringify(answer.body)).not.toContain("EAAG-real-token");
      expect(answer.body.data.accessTokenMasked).toBe("••••oken");
    }
  });

  it("is refused without a pixel or a conversion the merchant chose", async () => {
    for (const body of [{ pixelId: "1" }, { ...VALID, conversionEvent: "AddToCart" }, { conversionEvent: "Purchase" }]) {
      const { status, body: answer } = await save(body);
      expect(status, JSON.stringify(body)).toBe(400);
      expect(answer.category).toBe(ERROR_CATEGORIES.VALIDATION);
    }
    expect(await storedRow()).toBeUndefined();
  });
});
