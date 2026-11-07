/**
 * Coupons — real D1, real migrations, real routes.
 *
 *  1. The database keeps every coupon coherent on its own, and counts uses:
 *     the usage limit and one use per customer are enforced when an order is
 *     inserted, a cancelled order gives its use back, a coupon is applied at
 *     placement only, and a deleted coupon leaves its code on its orders.
 *  2. Every write through the routes is judged whole, names only records that
 *     exist, keeps codes unique in their one form, and is read back with where
 *     the coupon stands, its uses and the discount it gave.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { signIn } from "@/test-utils/sign-in";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import { getCouponTools } from "./ai-tools";
import couponsRouter from "./routes";

const T = "2026-10-01T00:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const run = (query: string) => d1.raw.prepare(query).run();
const first = <R>(query: string) => d1.raw.prepare(query).first<R>();

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as AppContext["Bindings"];
    signIn(c, { id: "admin", name: "Admin", role: "admin", status: "active", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/coupons", couponsRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [
    "order_products",
    "orders",
    "coupon_products",
    "coupon_collections",
    "coupon_customers",
    "coupon_customer_groups",
    "coupons",
    "collection_products",
    "collections",
    "customer_group_members",
    "customer_groups",
    "customers",
    "products",
    "stores",
  ]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Boutique", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values([
    { id: "robe", name: "Robe", handle: "robe", price: 2000, createdAt: T, updatedAt: T },
    { id: "sac", name: "Sac", handle: "sac", price: 1500, createdAt: T, updatedAt: T },
  ]);
  await d1.db.insert(schema.collections).values({ id: "ete", storeId: "s1", handle: "ete", title: "Été", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.customers).values([
    { id: "amel", name: "Amel", phone: "0550000001", wilaya: "Alger", createdAt: T },
    { id: "yanis", name: "Yanis", phone: "0550000002", wilaya: "Oran", createdAt: T },
  ]);
  await d1.db.insert(schema.customerGroups).values({ id: "vip", name: "VIP", createdAt: T, updatedAt: T });
});

const coupon = (id: string, columns: Record<string, string | number | null> = {}) => {
  const values = { id, code: `CODE-${id.toUpperCase()}`, kind: "percentage", value: 10, created_at: T, updated_at: T, ...columns };
  const sqlValue = (value: string | number | null) => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value}'`);
  return run(`INSERT INTO coupons (${Object.keys(values).join(", ")}) VALUES (${Object.values(values).map(sqlValue).join(", ")})`);
};

let orderSeq = 0;
const order = (couponId: string | null, customerId = "amel", status = "new") => {
  const id = `o${++orderSeq}`;
  return run(
    `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, coupon_id, coupon_code, coupon_discount, created_at, updated_at)
     VALUES ('${id}', 'N${id}', '${customerId}', 'C', '0550000001', 2000, '${status}', ${couponId ? `'${couponId}'` : "NULL"}, ${couponId ? `'${couponId.toUpperCase()}'` : "NULL"}, ${couponId ? 200 : 0}, '${T}', '${T}')`,
  ).then(() => id);
};

describe("the database keeps a coupon coherent", () => {
  it("accepts a coherent coupon of every kind", async () => {
    await coupon("pct", { max_discount: 1500, min_subtotal: 3000 });
    await coupon("fixed", { kind: "fixed_amount", value: 500, min_quantity: 2 });
    await coupon("ship", { kind: "free_shipping", value: 0 });
    expect(await first("SELECT count(*) AS n FROM coupons")).toEqual({ n: 3 });
  });

  it("refuses a code that is not in its one form, or is taken", async () => {
    await expect(coupon("a", { code: "ramadan" })).rejects.toThrow();
    await expect(coupon("b", { code: "RAMA DAN" })).rejects.toThrow();
    await expect(coupon("c", { code: "AB" })).rejects.toThrow();
    await expect(coupon("d", { code: "SALE!" })).rejects.toThrow();
    await coupon("e", { code: "VIP_CLUB-1" });
    await expect(coupon("f", { code: "VIP_CLUB-1" })).rejects.toThrow(/UNIQUE/);
  });

  it("refuses a value, cap, minimum or schedule its kind cannot have", async () => {
    await expect(coupon("a", { value: 0 })).rejects.toThrow();
    await expect(coupon("b", { value: 101 })).rejects.toThrow();
    await expect(coupon("c", { kind: "fixed_amount", value: 0 })).rejects.toThrow();
    await expect(coupon("d", { kind: "free_shipping", value: 1 })).rejects.toThrow();
    await expect(coupon("e", { kind: "fixed_amount", value: 500, max_discount: 400 })).rejects.toThrow();
    await expect(coupon("f", { min_subtotal: 3000, min_quantity: 2 })).rejects.toThrow();
    await expect(coupon("g", { usage_limit: 0 })).rejects.toThrow();
    await expect(coupon("h", { kind: "bogus" })).rejects.toThrow();
    await expect(coupon("i", { starts_at: "2026-11-02T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" })).rejects.toThrow();
  });

  it("lets a removed product, collection, customer or group take its rows, and a removed coupon take all of them", async () => {
    await coupon("pick");
    await run("INSERT INTO coupon_products VALUES ('pick', 'robe'), ('pick', 'sac')");
    await run("INSERT INTO coupon_collections VALUES ('pick', 'ete')");
    await run("INSERT INTO coupon_customers VALUES ('pick', 'amel')");
    await run("INSERT INTO coupon_customer_groups VALUES ('pick', 'vip')");
    await run("DELETE FROM products WHERE id = 'robe'");
    await run("DELETE FROM collections WHERE id = 'ete'");
    await run("DELETE FROM customers WHERE id = 'amel'");
    await run("DELETE FROM customer_groups WHERE id = 'vip'");
    expect(await first("SELECT (SELECT count(*) FROM coupon_products) p, (SELECT count(*) FROM coupon_collections) c, (SELECT count(*) FROM coupon_customers) k, (SELECT count(*) FROM coupon_customer_groups) g")).toEqual({ p: 1, c: 0, k: 0, g: 0 });
    await run("DELETE FROM coupons WHERE id = 'pick'");
    expect(await first("SELECT count(*) AS n FROM coupon_products")).toEqual({ n: 0 });
  });
});

describe("the database counts a coupon's uses", () => {
  it("refuses the order past the usage limit, and a cancelled order gives its use back", async () => {
    await coupon("twice", { usage_limit: 2 });
    await order("twice", "amel");
    const second = await order("twice", "yanis");
    await expect(order("twice", "yanis")).rejects.toThrow(/COUPON_USED_UP/);
    await run(`UPDATE orders SET status = 'cancelled' WHERE id = '${second}'`);
    await order("twice", "yanis");
    await expect(order("twice", "amel")).rejects.toThrow(/COUPON_USED_UP/);
    await order(null, "amel");
  });

  it("refuses a customer's second use when once per customer, and a cancelled one does not count", async () => {
    await coupon("once", { once_per_customer: 1 });
    const firstUse = await order("once", "amel");
    await expect(order("once", "amel")).rejects.toThrow(/COUPON_ALREADY_USED/);
    await order("once", "yanis");
    await run(`UPDATE orders SET status = 'cancelled' WHERE id = '${firstUse}'`);
    await order("once", "amel");
  });

  it("never lets two orders take the last use", async () => {
    await coupon("last", { usage_limit: 1 });
    const outcomes = await Promise.allSettled([order("last", "amel"), order("last", "yanis"), order("last", "amel")]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await first("SELECT count(*) AS n FROM orders WHERE coupon_id = 'last'")).toEqual({ n: 1 });
  });

  it("applies a coupon when an order is placed, never afterwards", async () => {
    await coupon("late");
    const plain = await order(null);
    await expect(run(`UPDATE orders SET coupon_id = 'late' WHERE id = '${plain}'`)).rejects.toThrow(/COUPON_AT_PLACEMENT_ONLY/);
    const used = await order("late");
    await run(`UPDATE orders SET notes = 'rappeler' WHERE id = '${used}'`);
  });

  it("leaves a deleted coupon's code and discount on its orders", async () => {
    await coupon("gone");
    const used = await order("gone");
    await run("DELETE FROM coupons WHERE id = 'gone'");
    expect(await first(`SELECT coupon_id, coupon_code, coupon_discount FROM orders WHERE id = '${used}'`)).toEqual({ coupon_id: null, coupon_code: "GONE", coupon_discount: 200 });
  });

  it("refuses a negative discount on an order or a line", async () => {
    await expect(run(`INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, coupon_discount, created_at, updated_at) VALUES ('neg', 'NNEG', 'amel', 'C', '0', 1, -1, '${T}', '${T}')`)).rejects.toThrow();
    const id = await order(null);
    await expect(run(`INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, discount, created_at) VALUES ('l', '${id}', 'robe', 'Robe', 1, 1, 1, -1, '${T}')`)).rejects.toThrow();
  });
});

describe("coupons through the real routes", () => {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const create = (body: Record<string, unknown>) => call("POST", "/api/coupons", { kind: "percentage", value: 10, ...body });

  it("stores the code in its one form, and reads the coupon back live and unused", async () => {
    const created = await create({ code: " ramadan ١٠ " });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: "RAMADAN10",
      kind: "percentage",
      value: 10,
      maxDiscount: null,
      scope: "store",
      audience: "everyone",
      oncePerCustomer: false,
      status: "active",
      state: "live",
      uses: 0,
      discountGiven: 0,
      products: [],
      customers: [],
    });
  });

  it("keeps codes unique whatever way they are typed", async () => {
    const owner = await create({ code: "EID2026" });
    const taken = await create({ code: "eid 2026" });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "COUPON_CODE_TAKEN", context: { couponId: owner.body.data.id } });
    const other = await create({ code: "EID2027" });
    expect((await call("PATCH", `/api/coupons/${other.body.data.id}`, { code: "eid2026" })).status).toBe(409);
    expect((await call("PATCH", `/api/coupons/${owner.body.data.id}`, { code: "eid2026", value: 15 })).status).toBe(200);
  });

  it("refuses an incoherent coupon and says why", async () => {
    const reason = async (body: Record<string, unknown>) => {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_COUPON");
      return response.body.context.reason;
    };
    expect(await reason({ code: "SALE!" })).toBe("invalid_code");
    expect(await reason({ code: "BIG", value: 120 })).toBe("invalid_value");
    expect(await reason({ code: "FIX", kind: "fixed_amount", value: 500, maxDiscount: 400 })).toBe("max_discount_not_allowed");
    expect(await reason({ code: "MIN", minSubtotal: 3000, minQuantity: 2 })).toBe("minimum_conflict");
    expect(await reason({ code: "SCOPE", scope: "products" })).toBe("scope_empty");
    expect(await reason({ code: "MIX", scope: "products", productIds: ["robe"], collectionIds: ["ete"] })).toBe("scope_mismatch");
    expect(await reason({ code: "WHO", audience: "selected" })).toBe("audience_empty");
    expect(await reason({ code: "GHOST", scope: "products", productIds: ["robe", "nope"] })).toBe("unknown_product");
    expect(await reason({ code: "GHOSTC", scope: "collections", collectionIds: ["nope"] })).toBe("unknown_collection");
    expect(await reason({ code: "GHOSTK", audience: "selected", customerIds: ["nope"] })).toBe("unknown_customer");
    expect(await reason({ code: "GHOSTG", audience: "selected", groupIds: ["nope"] })).toBe("unknown_group");
    expect(await first("SELECT count(*) AS n FROM coupons")).toEqual({ n: 0 });
  });

  it("names what it covers and who may use it, and the list counts them", async () => {
    const products = await create({ code: "ROBES", scope: "products", productIds: ["robe", "sac", "robe"], audience: "selected", customerIds: ["yanis"], groupIds: ["vip"] });
    expect(products.status).toBe(201);
    expect(products.body.data).toMatchObject({
      products: [
        { id: "robe", name: "Robe", handle: "robe" },
        { id: "sac", name: "Sac", handle: "sac" },
      ],
      collections: [],
      customers: [{ id: "yanis", name: "Yanis", phone: "0550000002" }],
      groups: [{ id: "vip", name: "VIP" }],
    });
    const summer = await create({ code: "ETE", scope: "collections", collectionIds: ["ete"] });
    expect(summer.body.data.collections).toEqual([{ id: "ete", title: "Été", handle: "ete" }]);

    const list = await call("GET", "/api/coupons");
    const counts = Object.fromEntries(list.body.data.map((row: any) => [row.code, row.counts]));
    expect(counts).toEqual({
      ROBES: { products: 2, collections: 0, customers: 1, groups: 1 },
      ETE: { products: 0, collections: 1, customers: 0, groups: 0 },
    });
  });

  it("writes picks beyond one statement's limit, all of them", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `k${String(i).padStart(3, "0")}`);
    for (let at = 0; at < ids.length; at += 10) {
      await d1.db.insert(schema.customers).values(ids.slice(at, at + 10).map((id) => ({ id, name: id, phone: `07${id}`, wilaya: "Alger", createdAt: T })));
    }
    const created = await create({ code: "MANY", audience: "selected", customerIds: ids });
    expect(created.status).toBe(201);
    expect(created.body.data.customers.map((customer: any) => customer.id).sort()).toEqual(ids);
    const trimmed = await call("PATCH", `/api/coupons/${created.body.data.id}`, { customerIds: ids.slice(0, 50) });
    expect(trimmed.body.data.customers).toHaveLength(50);
  });

  it("judges an edit with the fields it leaves, and starts a changed kind, scope or audience afresh", async () => {
    const created = await create({ code: "EDIT", value: 20, maxDiscount: 1500, scope: "products", productIds: ["robe"], audience: "selected", customerIds: ["amel"] });
    const id = created.body.data.id;

    const refused = await call("PATCH", `/api/coupons/${id}`, { kind: "fixed_amount", value: 500, maxDiscount: 400 });
    expect(refused.body.context.reason).toBe("max_discount_not_allowed");
    expect((await call("PATCH", `/api/coupons/${id}`, { minQuantity: 2 })).status).toBe(200);
    expect((await call("PATCH", `/api/coupons/${id}`, { minSubtotal: 3000 })).body.context.reason).toBe("minimum_conflict");

    const shipping = await call("PATCH", `/api/coupons/${id}`, { kind: "free_shipping" });
    expect(shipping.status).toBe(200);
    expect(shipping.body.data).toMatchObject({ kind: "free_shipping", value: 0, maxDiscount: null, minQuantity: 2, products: [{ id: "robe" }], customers: [{ id: "amel" }] });

    const everywhere = await call("PATCH", `/api/coupons/${id}`, { scope: "store", audience: "everyone" });
    expect(everywhere.body.data).toMatchObject({ scope: "store", products: [], audience: "everyone", customers: [] });
    expect(await first(`SELECT (SELECT count(*) FROM coupon_products) p, (SELECT count(*) FROM coupon_customers) k`)).toEqual({ p: 0, k: 0 });

    expect((await call("PATCH", `/api/coupons/${id}`, { minQuantity: null, minSubtotal: 3000, endsAt: "2099-01-01T00:00:00.000Z" })).body.data).toMatchObject({ minQuantity: null, minSubtotal: 3000 });
    expect((await call("PATCH", `/api/coupons/${id}`, { minSubtotal: null, endsAt: null })).body.data).toMatchObject({ minSubtotal: null, endsAt: null });
    expect((await call("PATCH", "/api/coupons/nope", { value: 5 })).status).toBe(404);
  });

  it("reads uses and the discount given from orders not cancelled, and where the coupon stands", async () => {
    const created = await create({ code: "COUNT", usageLimit: 2 });
    const id = created.body.data.id;
    await run(`UPDATE coupons SET id = 'count' WHERE id = '${id}'`);
    await order("count", "amel");
    const cancelled = await order("count", "yanis");
    await run(`UPDATE orders SET status = 'cancelled' WHERE id = '${cancelled}'`);
    expect((await call("GET", "/api/coupons/count")).body.data).toMatchObject({ uses: 1, discountGiven: 200, state: "live" });
    await order("count", "yanis");
    expect((await call("GET", "/api/coupons/count")).body.data).toMatchObject({ uses: 2, discountGiven: 400, state: "used_up" });
    expect((await call("GET", "/api/coupons")).body.data[0]).toMatchObject({ uses: 2, state: "used_up" });
    expect((await call("PATCH", "/api/coupons/count", { status: "inactive" })).body.data.state).toBe("inactive");
    expect((await call("PATCH", "/api/coupons/count", { status: "active", startsAt: "2099-01-01T00:00:00.000Z" })).body.data.state).toBe("scheduled");
    expect((await call("PATCH", "/api/coupons/count", { startsAt: null, endsAt: "2000-01-01T00:00:00.000Z" })).body.data.state).toBe("expired");
  });

  it("deletes a coupon once; its orders keep the code", async () => {
    const created = await create({ code: "BYE" });
    const id = created.body.data.id;
    await run(`UPDATE coupons SET id = 'bye' WHERE id = '${id}'`);
    const used = await order("bye");
    expect((await call("DELETE", "/api/coupons/bye")).status).toBe(200);
    expect((await call("DELETE", "/api/coupons/bye")).status).toBe(404);
    expect((await call("GET", "/api/coupons/bye")).status).toBe(404);
    expect(await first(`SELECT coupon_id, coupon_code FROM orders WHERE id = '${used}'`)).toEqual({ coupon_id: null, coupon_code: "BYE" });
  });
});

describe("coupons through the AI tools", () => {
  const exec = (tools: ReturnType<typeof getCouponTools>, name: keyof ReturnType<typeof getCouponTools>, args: unknown) =>
    (tools[name].execute as (args: unknown, options: unknown) => Promise<any>)(args, {});

  it("write the same coupons the routes do, refused for the same reasons", async () => {
    const tools = getCouponTools(d1.db);
    expect(await exec(tools, "createCoupon", { code: "x" })).toMatchObject({ success: false });
    expect(await exec(tools, "createCoupon", { code: "VIP", kind: "percentage", value: 10, audience: "selected" })).toMatchObject({
      success: false,
      error: expect.stringContaining("audience_empty"),
    });
    const created = await exec(tools, "createCoupon", { code: "vip 10", kind: "percentage", value: 10, audience: "selected", groupIds: ["vip"] });
    expect(created).toMatchObject({ success: true, coupon: { code: "VIP10", groups: [{ id: "vip" }] } });
    const id = created.coupon.id;

    expect(await exec(tools, "createCoupon", { code: "VIP10", kind: "fixed_amount", value: 100 })).toMatchObject({
      success: false,
      error: expect.stringContaining("code_taken"),
    });
    expect(await exec(tools, "updateCoupon", { couponId: id, updates: { value: 15 } })).toMatchObject({ success: true, coupon: { value: 15 } });
    expect(await exec(tools, "listCoupons", {})).toMatchObject({ success: true, count: 1, coupons: [{ code: "VIP10", state: "live" }] });
    expect(await exec(tools, "deleteCoupon", { couponId: id })).toMatchObject({ success: true });
    expect(await exec(tools, "getCouponDetails", { couponId: id })).toMatchObject({ success: false });
  });
});
