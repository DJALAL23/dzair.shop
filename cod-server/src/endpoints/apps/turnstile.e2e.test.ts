/**
 * The Turnstile App through the API, on real D1: who may see and set it up,
 * that its secret never leaves the server, and that it is never on without
 * both keys.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
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
  await d1.db.delete(schema.storeTurnstileConfig);
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

async function setUp() {
  await d1.db.insert(schema.storeTurnstileConfig).values({ id: "t1", storeId: "s1", siteKey: "0x4AAA-site", secretKey: "0x4AAA-secret-b7c1", enabled: true, createdAt: T, updatedAt: T });
}

const stored = () => d1.db.select({ siteKey: schema.storeTurnstileConfig.siteKey, secretKey: schema.storeTurnstileConfig.secretKey }).from(schema.storeTurnstileConfig).get();

describe("who may see and set up Turnstile", () => {
  it("takes turnstile:read to see it and turnstile:manage to change it", async () => {
    expect((await as(["dzverify:read"]).get("/api/apps/turnstile")).status).toBe(403);
    expect((await as(["turnstile:read"]).get("/api/apps/turnstile")).status).toBe(200);
    expect((await as(["turnstile:read"]).put("/api/apps/turnstile", { siteKey: "a", secretKey: "b" })).status).toBe(403);
    expect((await as(["turnstile:manage"]).put("/api/apps/turnstile", { siteKey: "a", secretKey: "b" })).status).toBe(200);
  });
});

describe("Turnstile's setup", () => {
  it("is null before it is set up", async () => {
    expect((await admin.get("/api/apps/turnstile")).body.data).toBeNull();
  });

  it("shows the public site key and only a hint of the secret", async () => {
    await setUp();
    const { body } = await admin.get("/api/apps/turnstile");
    expect(body.data).toMatchObject({ siteKey: "0x4AAA-site", enabled: true, secretKeyMasked: "••••b7c1" });
    expect(JSON.stringify(body)).not.toContain("0x4AAA-secret");
  });

  it("saves both keys and answers the same safe view", async () => {
    const { status, body } = await admin.put("/api/apps/turnstile", { siteKey: "site-1", secretKey: "secret-9f2e", enabled: true });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ siteKey: "site-1", enabled: true, secretKeyMasked: "••••9f2e" });
    expect(await stored()).toEqual({ siteKey: "site-1", secretKey: "secret-9f2e" });
  });

  it("keeps the stored keys when the fields sent are empty or blank", async () => {
    await setUp();
    expect((await admin.put("/api/apps/turnstile", { siteKey: "", secretKey: "  ", enabled: false })).body.data).toMatchObject({ enabled: false, siteKey: "0x4AAA-site" });
    expect(await stored()).toEqual({ siteKey: "0x4AAA-site", secretKey: "0x4AAA-secret-b7c1" });
  });

  it("is refused without both keys", async () => {
    const none = await admin.put("/api/apps/turnstile", { enabled: true });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe(ERROR_CODES.REQUIRED_FIELD_MISSING);
    expect((await admin.put("/api/apps/turnstile", { secretKey: "only-the-secret" })).status).toBe(400);
    expect(await stored()).toBeUndefined();
  });
});
