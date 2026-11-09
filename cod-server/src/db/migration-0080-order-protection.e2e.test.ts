import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";

let d1: TestD1;
const T = "2026-11-09T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

const attempt = (id: string, extra: Partial<typeof schema.orderAttempts.$inferInsert> = {}) => ({ id, createdAt: T, phone: "0551234567", outcome: "accepted" as const, ...extra });

describe("0080 Order Protection", () => {
  it("makes the four tables, empty", async () => {
    expect(await d1.db.select().from(schema.storeOrderProtectionConfig)).toEqual([]);
    expect(await d1.db.select().from(schema.orderRules)).toEqual([]);
    expect(await d1.db.select().from(schema.orderBlockList)).toEqual([]);
    expect(await d1.db.select().from(schema.orderAttempts)).toEqual([]);
  });

  it("allows one Block List entry per kind and value", async () => {
    const entry = { kind: "phone" as const, value: "0551234567", createdAt: T };
    await d1.db.insert(schema.orderBlockList).values({ id: "b1", ...entry });
    await expect(d1.db.insert(schema.orderBlockList).values({ id: "b2", ...entry })).rejects.toThrow();
    await d1.db.insert(schema.orderBlockList).values({ id: "b3", ...entry, kind: "ip" });
  });

  it("keeps a Spam Order's number and checkout key unique, and only a Spam Order's", async () => {
    await d1.db.insert(schema.orderAttempts).values(attempt("a1", { outcome: "spam", orderNumber: "ORD-1", checkoutKey: "k1" }));
    await expect(d1.db.insert(schema.orderAttempts).values(attempt("a2", { outcome: "spam", orderNumber: "ORD-1", checkoutKey: "k2" }))).rejects.toThrow();
    await expect(d1.db.insert(schema.orderAttempts).values(attempt("a3", { outcome: "spam", orderNumber: "ORD-2", checkoutKey: "k1" }))).rejects.toThrow();
    await d1.db.insert(schema.orderAttempts).values(attempt("a4", { outcome: "accepted", orderNumber: "ORD-1", checkoutKey: "k1" }));
    await d1.db.insert(schema.orderAttempts).values(attempt("a5", { outcome: "spam", orderNumber: "ORD-3" }));
    await d1.db.insert(schema.orderAttempts).values(attempt("a6", { outcome: "spam", orderNumber: "ORD-4" }));
  });
});
