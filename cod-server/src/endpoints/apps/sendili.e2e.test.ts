/**
 * The Sendili App through the API, on real D1: who may see and set it up,
 * that its key never leaves the server, and what a key test answers for each
 * thing Sendili can say.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import * as sendili from "../../../../cod-shared/lib/sendili";
import { ERROR_CATEGORIES, ERROR_CODES } from "../../../../cod-shared/errors/codes";
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
  await d1.db.delete(schema.storeEmailConfig);
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
});

afterEach(() => vi.restoreAllMocks());

async function setUp(apiKey = "sk-sendili-secret-c3d4") {
  await d1.db.insert(schema.storeEmailConfig).values({ id: "e1", storeId: "s1", apiKey, fromEmail: "shop@acme.dz", fromName: "Acme", enabled: true, createdAt: T, updatedAt: T });
}

function sendiliAnswers(getAccount: () => Promise<unknown>) {
  return vi.spyOn(sendili, "createSendiliClient").mockReturnValue({ getAccount } as never);
}

const refusal = (code: string, status: number) => () => Promise.reject(new sendili.SendiliError(code as never, `refused: ${code}`, status));

describe("who may see and set up Sendili", () => {
  it("takes sendili:read to see it and sendili:manage to change or test it", async () => {
    expect((await as(["settings:email"]).get("/api/apps/sendili")).status).toBe(403);
    expect((await as(["sendili:read"]).get("/api/apps/sendili")).status).toBe(200);
    expect((await as(["sendili:read"]).put("/api/apps/sendili", { apiKey: "k", fromEmail: "a@acme.dz" })).status).toBe(403);
    expect((await as(["sendili:manage"]).put("/api/apps/sendili", { apiKey: "k", fromEmail: "a@acme.dz" })).status).toBe(200);
    expect((await as(["sendili:read"]).post("/api/apps/sendili/test", {})).status).toBe(403);
  });
});

describe("Sendili's setup", () => {
  it("is null before it is set up", async () => {
    expect((await admin.get("/api/apps/sendili")).body.data).toBeNull();
  });

  it("shows only a hint of the key", async () => {
    await setUp();
    const { body } = await admin.get("/api/apps/sendili");
    expect(body.data).toMatchObject({ fromEmail: "shop@acme.dz", fromName: "Acme", enabled: true, apiKeyMasked: "••••c3d4" });
    expect(JSON.stringify(body)).not.toContain("sk-sendili-secret");
  });

  it("keeps the stored key when the key sent is empty", async () => {
    await setUp("stored-key");
    const { status, body } = await admin.put("/api/apps/sendili", { apiKey: "", fromEmail: "orders@acme.dz", fromName: null, enabled: true });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ fromEmail: "orders@acme.dz", fromName: null, apiKeyMasked: "••••-key" });
    expect(await d1.db.select({ apiKey: schema.storeEmailConfig.apiKey }).from(schema.storeEmailConfig).get()).toEqual({ apiKey: "stored-key" });
  });

  it("is refused with no key stored or sent", async () => {
    const { status, body } = await admin.put("/api/apps/sendili", { fromEmail: "a@acme.dz", enabled: true });
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.REQUIRED_FIELD_MISSING);
  });

  it("is refused with a from address that is not one", async () => {
    const { status, body } = await admin.put("/api/apps/sendili", { apiKey: "k", fromEmail: "not-an-email" });
    expect(status).toBe(400);
    expect(body.category).toBe(ERROR_CATEGORIES.VALIDATION);
  });
});

describe("testing the Sendili key", () => {
  it("answers the verified domains, for the from-address picker", async () => {
    await setUp();
    sendiliAnswers(async () => ({ domains: ["acme.dz", "mail.acme.dz"], raw: { plan: "free" } }));
    expect((await admin.post("/api/apps/sendili/test", {})).body.data).toEqual({ ok: true, domains: ["acme.dz", "mail.acme.dz"], account: { plan: "free" } });
  });

  it("tests the key sent rather than the one stored", async () => {
    await setUp("stored-key");
    const client = sendiliAnswers(async () => ({ domains: [], raw: {} }));
    await admin.post("/api/apps/sendili/test", { apiKey: "typed-key" });
    expect(client).toHaveBeenCalledWith("typed-key");
  });

  it("reports a refused key as not ok — the check itself worked", async () => {
    await setUp();
    sendiliAnswers(refusal("UNAUTHORIZED", 401));
    const { status, body } = await admin.post("/api/apps/sendili/test", {});
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ok: false, reason: "invalid_key" });
  });

  it("passes on any other refusal with its code", async () => {
    await setUp();
    sendiliAnswers(refusal("FORBIDDEN", 403));
    expect((await admin.post("/api/apps/sendili/test", {})).body.data).toMatchObject({ ok: false, reason: "FORBIDDEN" });
  });

  it("says when the account is out of credits", async () => {
    await setUp();
    sendiliAnswers(refusal("OUT_OF_CREDITS", 402));
    expect((await admin.post("/api/apps/sendili/test", {})).body.data).toMatchObject({ ok: false, outOfCredits: true });
  });

  it("asks for a key first", async () => {
    const { status, body } = await admin.post("/api/apps/sendili/test", {});
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.REQUIRED_FIELD_MISSING);
  });
});
