/**
 * The DZVerify App through the API, on real D1: who may see and set it up,
 * that its key never leaves the server, and what a key test answers for each
 * thing dzverify can say.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import * as dzverify from "@/endpoints/store-otp/dzverify";
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
  await d1.db.delete(schema.storeOtpConfig);
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

afterEach(() => vi.restoreAllMocks());

async function setUp(apiKey = "dz-super-secret-a9f2", enabled = true) {
  await d1.db.insert(schema.storeOtpConfig).values({ id: "o1", storeId: "s1", apiKey, language: "ar", enabled, createdAt: T, updatedAt: T });
}

function dzverifyAnswers(getQuota: () => Promise<unknown>) {
  return vi.spyOn(dzverify, "createDzverifyClient").mockReturnValue({ getQuota } as never);
}

describe("who may see and set up DZVerify", () => {
  it("takes dzverify:read to see it and dzverify:manage to change it", async () => {
    expect((await as(["orders:read"]).get("/api/apps/dzverify")).status).toBe(403);
    expect((await as(["dzverify:read"]).get("/api/apps/dzverify")).status).toBe(200);
    expect((await as(["dzverify:read"]).put("/api/apps/dzverify", { apiKey: "k" })).status).toBe(403);
    expect((await as(["dzverify:manage"]).put("/api/apps/dzverify", { apiKey: "k" })).status).toBe(200);
    expect((await as(["dzverify:read"]).post("/api/apps/dzverify/test", {})).status).toBe(403);
  });

  it("is not opened by the permission it replaced", async () => {
    expect((await as(["settings:verification"]).get("/api/apps/dzverify")).status).toBe(403);
  });
});

describe("DZVerify's setup", () => {
  it("is null before it is set up", async () => {
    expect((await admin.get("/api/apps/dzverify")).body.data).toBeNull();
  });

  it("shows only a hint of the key", async () => {
    await setUp();
    const { body } = await admin.get("/api/apps/dzverify");
    expect(body.data).toMatchObject({ language: "ar", enabled: true, apiKeyMasked: "••••a9f2" });
    expect(JSON.stringify(body)).not.toContain("dz-super-secret");
  });

  it("keeps the stored key when the key sent is empty", async () => {
    await setUp("stored-key", false);
    const { status, body } = await admin.put("/api/apps/dzverify", { apiKey: "", language: "fr", enabled: true });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ language: "fr", enabled: true, apiKeyMasked: "••••-key" });
    expect(await d1.db.select({ apiKey: schema.storeOtpConfig.apiKey }).from(schema.storeOtpConfig).get()).toEqual({ apiKey: "stored-key" });
  });

  it("is refused with no key stored or sent", async () => {
    const { status, body } = await admin.put("/api/apps/dzverify", { enabled: true });
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.REQUIRED_FIELD_MISSING);
  });
});

describe("testing the DZVerify key", () => {
  it("answers the quota for a working key", async () => {
    await setUp();
    dzverifyAnswers(async () => ({ balanceCentimes: 5000, balanceDa: 50, otpEstimate: 10, plan: "trial", trialGrantedAt: null, grantedAt: 1, updatedAt: 1 }));
    expect((await admin.post("/api/apps/dzverify/test", {})).body.data).toEqual({ ok: true, balanceDa: 50, otpEstimate: 10, plan: "trial" });
  });

  it("tests the key sent rather than the one stored", async () => {
    await setUp("stored-key");
    const client = dzverifyAnswers(async () => ({ balanceDa: 1, otpEstimate: 1, plan: "pro" }));
    await admin.post("/api/apps/dzverify/test", { apiKey: " typed-key " });
    expect(client).toHaveBeenCalledWith("typed-key");
  });

  it("reports a refused key as not ok — the check itself worked", async () => {
    await setUp();
    dzverifyAnswers(async () => Promise.reject(new dzverify.DzverifyError("UNAUTHORIZED", "bad key", 401)));
    const { status, body } = await admin.post("/api/apps/dzverify/test", {});
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ok: false, reason: "invalid_key" });
  });

  it("calls a key without usage:read valid, its quota unknown", async () => {
    await setUp();
    dzverifyAnswers(async () => Promise.reject(new dzverify.DzverifyError("FORBIDDEN", "missing scope", 403)));
    expect((await admin.post("/api/apps/dzverify/test", {})).body.data).toMatchObject({ ok: true, reason: "quota_scope_missing" });
  });

  it("says when the account is out of credits", async () => {
    await setUp();
    dzverifyAnswers(async () => Promise.reject(new dzverify.DzverifyError("OUT_OF_CREDITS", "no money", 402, { reason: "exhausted" })));
    expect((await admin.post("/api/apps/dzverify/test", {})).body.data).toMatchObject({ ok: false, outOfCredits: true });
  });

  it("asks for a key first", async () => {
    const { status, body } = await admin.post("/api/apps/dzverify/test", {});
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.REQUIRED_FIELD_MISSING);
  });
});
