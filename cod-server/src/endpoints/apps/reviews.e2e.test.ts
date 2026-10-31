/**
 * The Reviews App through the API, on real D1: who may see and change the
 * store's review rules, that a save keeps the rules it does not name and
 * refuses a rule outside its choices, that the App is turned off rather than
 * removed, and that the rules are no longer store settings.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import { TEST_MEDIA_VARS } from "@/test-utils/media";
import * as schema from "@/db/schema";
import { getReviewPolicy } from "../../../../cod-shared/queries/store-reviews";
import storesRouter from "../stores/routes";
import appsRouter from "./routes";

let d1: TestD1;
let admin: Api;
const T = "2026-10-31T08:00:00.000Z";
const routers = { "/api/apps": appsRouter, "/api/stores": storesRouter };
const as = (scopes: string[]) => apiAs(d1, staff(scopes), routers, TEST_MEDIA_VARS);

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, routers, TEST_MEDIA_VARS);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

const statusOf = async () => (await admin.get("/api/apps")).body.data.find((app: { key: string }) => app.key === "reviews");

describe("who may see and change the review rules", () => {
  it("takes reviews:read to see them and reviews:manage to change them", async () => {
    expect((await as(["reviews:create"]).get("/api/apps/reviews")).status).toBe(403);
    expect((await as(["reviews:read"]).get("/api/apps/reviews")).status).toBe(200);
    expect((await as(["reviews:read"]).put("/api/apps/reviews", { enabled: false })).status).toBe(403);
    expect((await as(["reviews:manage"]).put("/api/apps/reviews", { enabled: false })).status).toBe(200);
  });

  it("lists the Reviews App to whoever may see reviews", async () => {
    const { body } = await as(["reviews:read"]).get("/api/apps");
    expect(body.data).toEqual([{ key: "reviews", category: "storefront", status: "on" }]);
  });
});

describe("the review rules", () => {
  it("start as a new store's defaults", async () => {
    expect((await admin.get("/api/apps/reviews")).body.data).toEqual({ enabled: true, maxPhotos: 3, voiceMaxSeconds: null, autoPublish: "text_only" });
  });

  it("change the rules a save names and keep the others", async () => {
    const saved = await admin.put("/api/apps/reviews", { maxPhotos: 5, voiceMaxSeconds: 90, autoPublish: "all" });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ enabled: true, maxPhotos: 5, voiceMaxSeconds: 90, autoPublish: "all" });
    await admin.put("/api/apps/reviews", { voiceMaxSeconds: null, maxPhotos: 0 });
    expect(await getReviewPolicy(d1.db, "s1")).toEqual({ enabled: true, maxPhotos: 0, voiceMaxSeconds: null, autoPublish: "all" });
  });

  it("refuse a rule outside its choices and save nothing", async () => {
    for (const bad of [{ maxPhotos: 7 }, { voiceMaxSeconds: 45 }, { autoPublish: "some" }, { maxPhotos: 1.5 }, { enabled: "false" }]) {
      expect((await admin.put("/api/apps/reviews", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await admin.get("/api/apps/reviews")).body.data).toEqual({ enabled: true, maxPhotos: 3, voiceMaxSeconds: null, autoPublish: "text_only" });
  });
});

describe("the Reviews App's status", () => {
  it("is On while the store takes reviews and Off once it stops", async () => {
    expect(await statusOf()).toEqual({ key: "reviews", category: "storefront", status: "on" });
    await admin.put("/api/apps/reviews", { enabled: false });
    expect(await statusOf()).toMatchObject({ status: "off" });
  });

  it("is turned off, never removed: it has no remove route", async () => {
    expect((await appsRouter.request("/reviews", { method: "DELETE" })).status).toBe(404);
    expect((await getReviewPolicy(d1.db, "s1")).enabled).toBe(true);
  });
});

describe("the store settings", () => {
  it("no longer show or change the review rules", async () => {
    const store = (await admin.get("/api/stores/me")).body.data;
    for (const field of ["reviewsEnabled", "reviewMaxPhotos", "reviewVoiceMaxSeconds", "reviewAutoPublish"]) expect(store).not.toHaveProperty(field);
    expect((await admin.patch("/api/stores/me", { name: "Renamed", reviewsEnabled: false })).status).toBe(200);
    expect((await getReviewPolicy(d1.db, "s1")).enabled).toBe(true);
  });
});
