/**
 * Saving a profile's wilaya prices through the real route on real D1: a
 * wilaya that stays keeps its commune prices, one that goes takes them with
 * it, and a whole country of rules is written at once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { signIn } from "@/test-utils/sign-in";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";
import router from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-11-12T08:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: [] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/shipping-profiles", router);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  await d1.db.delete(schema.shippingProfiles);
  await d1.db.insert(schema.shippingProfiles).values({ id: "zr", name: "ZR Express", isDefault: false, createdAt: T, updatedAt: T });
});

const rule = (wilayaId: number, homePrice: number, stopDeskPrice = 300) => ({ wilayaId, homePrice, stopDeskPrice, homeEnabled: true, stopDeskEnabled: true });
const save = (rules: unknown[]) => app.request("/api/shipping-profiles/zr/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) });
const setCommune = (wilayaId: number, communeId: string, body: unknown) =>
  app.request(`/api/shipping-profiles/zr/rules/${wilayaId}/communes/${communeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rules = () => d1.db.select().from(schema.shippingRules).where(eq(schema.shippingRules.profileId, "zr")).all();
const overrides = () => d1.db.select({ communeId: schema.shippingRuleCommunes.communeId, homePrice: schema.shippingRuleCommunes.homePrice }).from(schema.shippingRuleCommunes).all();

describe("saving a profile's wilaya prices", () => {
  it("keeps the commune prices of a wilaya that stays, and changes only its own prices", async () => {
    expect((await save([rule(16, 600), rule(31, 700)])).status).toBe(200);
    expect((await setCommune(16, "c-16-001", { homePrice: 800 })).status).toBe(200);
    const before = (await rules()).find((r) => r.wilayaId === 16)!;

    expect((await save([rule(16, 650), rule(31, 700)])).status).toBe(200);
    const after = await rules();
    expect(after.find((r) => r.wilayaId === 16)).toMatchObject({ id: before.id, homePrice: 650 });
    expect(await overrides()).toEqual([{ communeId: "c-16-001", homePrice: 800 }]);
  });

  it("removes a wilaya that goes, with its commune prices, and adds a new one", async () => {
    await save([rule(16, 600), rule(31, 700)]);
    await setCommune(16, "c-16-001", { homePrice: 800 });
    expect((await save([rule(31, 700), rule(9, 500)])).status).toBe(200);
    expect((await rules()).map((r) => r.wilayaId).sort((a, b) => a - b)).toEqual([9, 31]);
    expect(await overrides()).toEqual([]);
  });

  it("writes every wilaya of the country at once, and empties the profile when asked", async () => {
    const all = Array.from({ length: LAST_WILAYA_ID }, (_, i) => rule(i + 1, 400 + i));
    expect((await save(all)).status).toBe(200);
    expect(await rules()).toHaveLength(LAST_WILAYA_ID);
    expect((await save([])).status).toBe(200);
    expect(await rules()).toHaveLength(0);
  });

  it("refuses a wilaya named twice and changes nothing", async () => {
    await save([rule(16, 600)]);
    expect((await save([rule(16, 600), rule(16, 700)])).status).toBe(400);
    expect((await rules()).map((r) => r.homePrice)).toEqual([600]);
  });
});
