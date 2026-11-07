/**
 * The customer an order the merchant enters belongs to, through the real
 * routes on real D1 (phone UNIQUE since 0015).
 *
 * Proved: the customer chosen; the customer who already has the phone when
 * none was chosen — the order is entered, never a 500 on the unique phone;
 * a new customer for a new phone; and the AI tool links it the same way.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import ordersRouter from "./routes";
import { getOrderTools } from "./ai-tools";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-24T08:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let commune16: string;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: [] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  commune16 = (await d1.raw.prepare("select id from communes where wilaya_id = 16 order by id limit 1").first<{ id: string }>())!.id;
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  const db = d1.db;
  for (const table of [schema.stockMovements, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.activityLogs, schema.stores]) {
    await db.delete(table);
  }
  await db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
  await db.insert(schema.customers).values({ id: "karim", name: "Karim", phone: "0551234567", wilaya: "الجزائر", wilayaId: 16, createdAt: T });
  await db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 2000, hasVariants: false, inventory: 100, trackInventory: false, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T, updatedAt: T });
});

const entered = (customerId: string, phone: string, name = "Karim B.") => ({
  customerId, customerName: name, phone, wilayaId: 16, communeId: commune16, address: "12 Rue Didouche", deliveryType: "home" as const,
  orderType: "offline" as const, price: 2000, deliveryFee: 0,
  products: [{ productId: "robe", productName: "Robe", quantity: 1, pricePerUnit: 2000, lineTotal: 2000 }],
});

async function order(body: ReturnType<typeof entered>) {
  const res = await app.request("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as any;
  const row = res.status === 201 ? await d1.db.select().from(schema.orders).where(eq(schema.orders.id, json.data.id)).get() : undefined;
  return { status: res.status, json, row };
}

describe("the customer an order the merchant enters belongs to", () => {
  it("is the customer the merchant chose", async () => {
    const { status, row } = await order(entered("karim", "0551234567"));
    expect(status).toBe(201);
    expect(row?.customerId).toBe("karim");
  });

  it("is the customer who already has the phone when none was chosen, kept as they were", async () => {
    const { status, json, row } = await order(entered(crypto.randomUUID(), "0551234567"));
    expect(status).toBe(201);
    expect(row?.customerId).toBe("karim");
    expect(json.data.customerId).toBe("karim");
    const customers = await d1.db.select().from(schema.customers).all();
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ id: "karim", name: "Karim" });
    const { getCustomerById } = await import("../../../../cod-shared/queries/customers");
    expect(await getCustomerById(d1.db, "karim")).toMatchObject({ totalOrders: 1, totalSpent: 0 });
  });

  it("is a new customer for a new phone", async () => {
    const id = crypto.randomUUID();
    const { status, row } = await order(entered(id, "0661234567", "Amina"));
    expect(status).toBe(201);
    expect(row?.customerId).toBe(id);
    expect(await d1.db.select().from(schema.customers).where(eq(schema.customers.id, id)).get()).toMatchObject({ name: "Amina", phone: "0661234567", wilayaId: 16, communeId: commune16, address: "12 Rue Didouche" });
    const { getCustomerById } = await import("../../../../cod-shared/queries/customers");
    expect((await getCustomerById(d1.db, id))!.totalOrders).toBe(1);
  });

  it("is one new customer when two orders for a new phone are entered at once", async () => {
    const results = await Promise.all([order(entered(crypto.randomUUID(), "0771234567")), order(entered(crypto.randomUUID(), "0771234567"))]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const customers = await d1.db.select().from(schema.customers).where(eq(schema.customers.phone, "0771234567")).all();
    expect(customers).toHaveLength(1);
    expect(results.map((r) => r.row?.customerId)).toEqual([customers[0].id, customers[0].id]);
  });

  it("is linked the same way by the AI tool", async () => {
    const tools = getOrderTools(d1.db, { userId: "u1", role: "admin", scopes: [], name: "Staff", email: "s@example.com" });
    const result = await (tools.createOrder as unknown as { execute: (args: unknown) => Promise<any> }).execute(entered(crypto.randomUUID(), "0551234567"));
    expect(result.success).toBe(true);
    expect(result.order.customerId).toBe("karim");
    expect(await d1.db.select().from(schema.customers).all()).toHaveLength(1);
  });
});
