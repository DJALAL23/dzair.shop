/**
 * A store is not switched off from its settings: nothing ever read its
 * status, so neither the store settings API nor `/store/config` shows it, and
 * the settings never take it. The column stays.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, type Api } from "@/test-utils/api";
import { TEST_MEDIA_VARS } from "@/test-utils/media";
import * as schema from "@/db/schema";
import storesRouter from "./routes";

let d1: TestD1;
let admin: Api;
const T = "2026-10-31T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, { "/api/stores": storesRouter }, TEST_MEDIA_VARS);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

describe("the store settings", () => {
  it("neither show nor change the store's status", async () => {
    expect((await admin.get("/api/stores/me")).body.data).not.toHaveProperty("status");
    const saved = await admin.patch("/api/stores/me", { name: "Renamed", status: "inactive" });
    expect(saved.status).toBe(200);
    expect(saved.body.data).not.toHaveProperty("status");
    expect(await d1.db.select({ name: schema.stores.name, status: schema.stores.status }).from(schema.stores).get()).toEqual({ name: "Renamed", status: "active" });
  });
});
