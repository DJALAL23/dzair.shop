/**
 * Orders placed per store day, through the real route on real D1: the day
 * turns at 23:00 UTC, cancelled orders never count, and the window and the
 * one before it split exactly at their edges.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import analyticsRouter from "./routes";
import { jsonRequest, seedOrder, seedStore, shipmentsApp } from "../shipments/test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = [];

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes, { "/api/analytics": analyticsRouter });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const NOW = "2026-10-16T10:00:00.000Z";

async function placed(id: string, createdAt: string, extra: { status?: "cancelled"; price?: number } = {}) {
  const commune = (await d1.db.select({ id: schema.communes.id }).from(schema.communes).limit(1).all())[0].id;
  await seedOrder(d1.db, commune, { id, status: extra.status ?? "new", price: extra.price ?? 1500, deliveryFee: 400 });
  await d1.db.update(schema.orders).set({ createdAt }).where(eq(schema.orders.id, id));
}

const activity = async (query = "?days=7") => {
  const res = await jsonRequest(app, "GET", `/api/analytics/order-activity${query}`);
  return { status: res.status, body: (await res.json()) as any };
};

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["dashboard:view"];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await seedStore(d1.db, createEcotrackMockServer());
  await placed("today", "2026-10-16T09:00:00.000Z");
  await placed("late-evening", "2026-10-15T23:30:00.000Z", { price: 2600 });
  await placed("yesterday", "2026-10-15T22:30:00.000Z");
  await placed("dropped", "2026-10-16T08:00:00.000Z", { status: "cancelled" });
  await placed("first-day", "2026-10-09T23:00:00.000Z");
  await placed("just-before", "2026-10-09T22:59:59.000Z", { price: 600 });
  await placed("too-old", "2026-10-02T22:59:59.000Z");
  await placed("tomorrow", "2026-10-16T23:00:00.000Z");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("order activity", () => {
  it("counts each order on the store's day and leaves cancelled orders out", async () => {
    const { status, body } = await activity();
    expect(status).toBe(200);
    expect(body.data).toEqual({
      from: "2026-10-10",
      to: "2026-10-16",
      days: [
        { date: "2026-10-10", orders: 1, sales: 1900 },
        { date: "2026-10-15", orders: 1, sales: 1900 },
        { date: "2026-10-16", orders: 2, sales: 4900 },
      ],
      previous: { orders: 1, sales: 1000 },
    });
  });

  it("defaults to thirty days and refuses a window it does not offer", async () => {
    const { body } = await activity("");
    expect(body.data.from).toBe("2026-09-17");
    expect(body.data.previous).toEqual({ orders: 0, sales: 0 });
    expect(body.data.days.reduce((sum: number, day: any) => sum + day.orders, 0)).toBe(6);
    expect((await activity("?days=12")).status).toBe(400);
  });

  it("is read by whoever may see the dashboard or the orders", async () => {
    scopes = ["orders:read"];
    expect((await activity()).status).toBe(200);
    scopes = ["products:read"];
    expect((await activity()).status).toBe(403);
  });
});
