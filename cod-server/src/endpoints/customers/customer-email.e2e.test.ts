/**
 * A customer's email (migration 0069), through the real customers API on real
 * D1: typed by the merchant, kept lower-cased, cleared, searched; and given by
 * an order the merchant enters only while the customer has none.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { orderCustomerId } from "../../../../cod-shared/queries/customers";
import customersRouter from "./routes";

let d1: TestD1;
let admin: Api;
const NOW = "2026-10-31T08:00:00.000Z";
const customer = { name: "Amina Benali", phone: "0551234567", wilayaId: 16, communeId: "c-16-001" };

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, { "/api/customers": customersRouter });
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.customers);
});

const stored = async (id: string) => (await d1.db.select({ email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, id)).get())?.email;

describe("a customer's email, as the merchant types it", () => {
  it("is kept trimmed and lower-cased, and answered back", async () => {
    const created = await admin.post("/api/customers", { ...customer, email: "  Amina@Example.COM " });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe("amina@example.com");
    expect(await stored(created.body.data.id)).toBe("amina@example.com");
  });

  it("is optional, and an empty one is none", async () => {
    const created = await admin.post("/api/customers", { ...customer, email: "" });
    expect(created.status).toBe(201);
    expect(await stored(created.body.data.id)).toBeNull();
  });

  it("is refused when it is not an email, and nothing is created", async () => {
    expect((await admin.post("/api/customers", { ...customer, email: "amina@" })).status).toBe(400);
    expect(await d1.db.select().from(schema.customers)).toEqual([]);
  });

  it("is changed by an edit, cleared by an empty value or null, and left alone when absent", async () => {
    const { id } = (await admin.post("/api/customers", { ...customer, email: "amina@example.com" })).body.data;
    await admin.patch(`/api/customers/${id}`, { email: "New@Example.com" });
    expect(await stored(id)).toBe("new@example.com");
    await admin.patch(`/api/customers/${id}`, { name: "Amina B." });
    expect(await stored(id)).toBe("new@example.com");
    await admin.patch(`/api/customers/${id}`, { email: "" });
    expect(await stored(id)).toBeNull();
    await admin.patch(`/api/customers/${id}`, { email: "again@example.com" });
    await admin.patch(`/api/customers/${id}`, { email: null });
    expect(await stored(id)).toBeNull();
  });

  it("finds the customer when searched", async () => {
    await admin.post("/api/customers", { ...customer, email: "amina@example.com" });
    await admin.post("/api/customers", { ...customer, name: "Karim", phone: "0661234567" });
    const found = await admin.get("/api/customers?search=amina%40example");
    expect(found.body.data.map((row: { name: string }) => row.name)).toEqual(["Amina Benali"]);
  });
});

describe("a customer's email, from an order the merchant enters", () => {
  const order = (overrides: Partial<Parameters<typeof orderCustomerId>[1]> = {}) =>
    orderCustomerId(d1.db, { customerId: crypto.randomUUID(), name: "Amina", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", now: NOW, ...overrides });

  it("is given to the customer the order creates", async () => {
    const id = await order({ email: "amina@example.com" });
    expect(await stored(id)).toBe("amina@example.com");
  });

  it("fills a known customer's email only while they have none", async () => {
    const id = await order();
    expect(await stored(id)).toBeNull();
    expect(await order({ email: "first@example.com" })).toBe(id);
    expect(await stored(id)).toBe("first@example.com");
    await order({ email: "second@example.com" });
    expect(await stored(id)).toBe("first@example.com");
  });
});
