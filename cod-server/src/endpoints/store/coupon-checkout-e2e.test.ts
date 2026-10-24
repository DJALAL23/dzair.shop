/**
 * Coupons at checkout — real D1, real migrations, the real storefront routes.
 *
 * Each case asks the cart for its quote with the code, then places the same
 * order through POST /store/orders: the two must agree, and the order must be
 * written so its price is the sum of its lines (the cash a carrier collects).
 *
 *  1. What a coupon takes off: a percentage (capped), a fixed amount, free
 *     delivery — only from the lines in its scope that no offer applied to.
 *  2. Whether it applies: its minimum, its schedule and status, its usage
 *     limit, one use per customer, and its selected customers — each refusal
 *     told to the shopper by the quote, and an order carrying a refused code
 *     refused whole, with nothing written.
 *  3. Delivery after the coupon: the free-delivery threshold judges the net
 *     subtotal, and a free-delivery coupon with nothing to give is refused.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";
import { createStoreOrder, findOrCreateCustomer } from "../../../../cod-shared/queries/store";
import { CouponNotApplicableError, findCheckoutCoupon } from "../../../../cod-shared/queries/checkout-coupon";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-10-01T00:00:00.000Z";
const STORE = "store-coupons";
const HOME = { wilayaId: 16, communeId: "c-16-001", deliveryType: "home" as const };
const FEE = 600;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("storeId", STORE);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [
    "order_products",
    "order_status_history",
    "stock_movements",
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
    "offer_price_tiers",
    "offers",
    "product_variants",
    "products",
    "shipping_rules",
    "shipping_profiles",
    "stores",
  ]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: FEE, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  const product = (id: string, price: number) => ({ id, name: id, handle: id, price, sku: `SKU-${id}`, status: "ACTIVE" as const, inventory: 50, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values([product("robe", 3000), product("sac", 1000), product("bague", 2000)]);
  await d1.db.insert(schema.collections).values({ id: "ete", storeId: STORE, handle: "ete", title: "Été", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.collectionProducts).values({ collectionId: "ete", productId: "sac", addedAt: T });
});

type Line = { productId: string; quantity: number };
const items = (lines: Line[]) => lines.map((line) => ({ ...line, productName: line.productId }));

async function coupon(code: string, columns: Partial<typeof schema.coupons.$inferInsert> = {}) {
  await d1.db.insert(schema.coupons).values({ id: code.toLowerCase(), code, kind: "percentage", value: 10, createdAt: T, updatedAt: T, ...columns });
}

async function quote(lines: Line[], extra: { couponCode?: string; phone?: string; destination?: typeof HOME } = { destination: HOME }) {
  const response = await app.request("/store/cart/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items(lines), ...extra }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as any).data;
}

async function order(lines: Line[], couponCode?: string, phone = "0551234567") {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone, ...HOME, items: items(lines), ...(couponCode === undefined ? {} : { couponCode }) }),
  });
  return { status: response.status, json: (await response.json()) as any };
}

async function stored(orderId: string) {
  const [row, lines] = await Promise.all([
    d1.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get(),
    d1.db.select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, orderId)).all(),
  ]);
  return { row: row!, lines };
}

/** The quote with the code, then the order: they agree, and the order's price is the sum of its lines. */
async function quotedThenPlaced(lines: Line[], code: string, phone?: string) {
  const shown = await quote(lines, { couponCode: code, destination: HOME, ...(phone ? { phone } : {}) });
  const placed = await order(lines, code, phone);
  expect(placed.status).toBe(201);
  const { row, lines: written } = await stored(placed.json.data.orderId);
  expect(row.price).toBe(shown.subtotal);
  expect(row.deliveryFee).toBe(shown.delivery.fee);
  expect(row.codAmount).toBe(shown.delivery.total);
  expect(row.price).toBe(written.reduce((sum, line) => sum + line.lineTotal, 0));
  expect(row.couponDiscount).toBe(written.reduce((sum, line) => sum + line.discount, 0));
  for (const line of written) expect(line.pricePerUnit * line.quantity).toBeCloseTo(line.lineTotal, 6);
  expect(placed.json.data).toMatchObject({ price: row.price, deliveryFee: row.deliveryFee, total: row.codAmount, couponDiscount: row.couponDiscount });
  return { shown, row, written };
}

describe("what a coupon takes off", () => {
  it("takes a percentage of every line, shared by what each costs, and records it on the order and its lines", async () => {
    await coupon("RAMADAN10");
    const { shown, row, written } = await quotedThenPlaced([{ productId: "robe", quantity: 1 }, { productId: "sac", quantity: 2 }], " ramadan 10 ");
    expect(shown.coupon).toEqual({ code: "RAMADAN10", applied: true, discount: 500, freeShipping: false });
    expect(shown.lines.map((line: any) => [line.lineTotal, line.discount])).toEqual([[2700, 300], [1800, 200]]);
    expect(row).toMatchObject({ price: 4500, couponId: "ramadan10", couponCode: "RAMADAN10", couponDiscount: 500, deliveryFee: FEE, codAmount: 5100 });
    expect(written.map((line) => [line.productId, line.lineTotal, line.discount, line.pricePerUnit])).toEqual(
      expect.arrayContaining([["robe", 2700, 300, 2700], ["sac", 1800, 200, 900]]),
    );
  });

  it("caps a percentage at its most-off, and takes a fixed amount once, never more than the covered lines cost", async () => {
    await coupon("HALF", { value: 50, maxDiscount: 1000 });
    expect((await quotedThenPlaced([{ productId: "robe", quantity: 1 }], "HALF")).row).toMatchObject({ price: 2000, couponDiscount: 1000 });
    await coupon("MINUS5000", { kind: "fixed_amount", value: 5000, scope: "products" });
    await d1.db.insert(schema.couponProducts).values({ couponId: "minus5000", productId: "sac" });
    const { row } = await quotedThenPlaced([{ productId: "sac", quantity: 2 }, { productId: "bague", quantity: 1 }], "MINUS5000");
    expect(row).toMatchObject({ price: 2000, couponDiscount: 2000 });
  });

  it("covers only its products, or the products its collections hold when the order is placed", async () => {
    await coupon("ETE", { scope: "collections" });
    await d1.db.insert(schema.couponCollections).values({ couponId: "ete", collectionId: "ete" });
    const before = await quotedThenPlaced([{ productId: "robe", quantity: 1 }, { productId: "sac", quantity: 1 }], "ETE");
    expect(before.written.find((line) => line.productId === "robe")).toMatchObject({ discount: 0, lineTotal: 3000 });
    expect(before.row.couponDiscount).toBe(100);
    expect((await quote([{ productId: "bague", quantity: 1 }], { couponCode: "ETE", destination: HOME })).coupon).toEqual({ code: "ETE", applied: false, reason: "no_eligible_products" });

    await d1.db.insert(schema.collectionProducts).values({ collectionId: "ete", productId: "robe", addedAt: T });
    expect((await quotedThenPlaced([{ productId: "robe", quantity: 1 }], "ETE")).row.couponDiscount).toBe(300);
  });

  it("never covers a line an offer applied to — quantity pricing or a reward's trigger", async () => {
    await d1.db.insert(schema.offers).values([
      { id: "packs", name: "Packs", discountType: "quantity_price", triggerProductId: "robe", triggerQuantity: 2, rewardQuantity: 0, createdAt: T, updatedAt: T },
      { id: "gift", name: "Gift", triggerProductId: "bague", triggerQuantity: 1, rewardProductId: "sac", rewardQuantity: 1, createdAt: T, updatedAt: T },
    ]);
    await d1.db.insert(schema.offerPriceTiers).values({ offerId: "packs", quantity: 2, price: 5000, freeShipping: false });
    await coupon("ALL10");
    const { shown, row, written } = await quotedThenPlaced(
      [{ productId: "robe", quantity: 2 }, { productId: "bague", quantity: 1 }, { productId: "sac", quantity: 1 }],
      "ALL10",
    );
    expect(shown.lines.map((line: any) => [line.productId, line.offerId, line.discount])).toEqual([["robe", "packs", 0], ["bague", "gift", 0], ["sac", null, 100]]);
    expect(row).toMatchObject({ price: 5000 + 2000 + 900, couponDiscount: 100 });
    expect(written.find((line) => line.reward)).toMatchObject({ productId: "sac", lineTotal: 0, discount: 0 });

    const onlyOffers = await quote([{ productId: "robe", quantity: 2 }], { couponCode: "ALL10", destination: HOME });
    expect(onlyOffers.coupon).toEqual({ code: "ALL10", applied: false, reason: "offer_applied" });
  });

  it("covers a product whose quantity pricing changes nothing at the quantity bought", async () => {
    await d1.db.insert(schema.offers).values({ id: "packs", name: "Packs", discountType: "quantity_price", triggerProductId: "robe", triggerQuantity: 1, rewardQuantity: 0, createdAt: T, updatedAt: T });
    await d1.db.insert(schema.offerPriceTiers).values([
      { offerId: "packs", quantity: 1, price: 3000, freeShipping: false },
      { offerId: "packs", quantity: 2, price: 5000, freeShipping: false },
    ]);
    await coupon("DIX");
    const one = await quotedThenPlaced([{ productId: "robe", quantity: 1 }], "DIX", "0551000071");
    expect(one.written[0]).toMatchObject({ offerId: null, discount: 300, lineTotal: 2700 });

    const two = await quote([{ productId: "robe", quantity: 2 }], { couponCode: "DIX", destination: HOME });
    expect(two).toMatchObject({ subtotal: 5000, coupon: { applied: false, reason: "offer_applied" }, lines: [{ offerId: "packs" }] });
  });

  it("makes delivery free, and is refused when delivery already is — or when an offer already gave the product its delivery", async () => {
    await coupon("LIVRAISON", { kind: "free_shipping", value: 0 });
    const { shown, row } = await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "LIVRAISON");
    expect(shown.coupon).toEqual({ code: "LIVRAISON", applied: true, discount: 0, freeShipping: true });
    expect(shown.freeDelivery).toMatchObject({ qualified: true, remaining: 0, by: "coupon" });
    expect(row).toMatchObject({ price: 1000, deliveryFee: 0, codAmount: 1000, couponCode: "LIVRAISON", couponDiscount: 0 });

    await d1.db.update(schema.stores).set({ freeShippingThreshold: 1000 }).where(eq(schema.stores.id, STORE));
    expect((await quote([{ productId: "sac", quantity: 1 }], { couponCode: "LIVRAISON", destination: HOME })).coupon).toEqual({
      code: "LIVRAISON",
      applied: false,
      reason: "delivery_already_free",
    });
    const refused = await order([{ productId: "sac", quantity: 1 }], "LIVRAISON", "0551234568");
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "COUPON_NOT_APPLICABLE", context: { reason: "delivery_already_free" } });

    await d1.db.update(schema.stores).set({ freeShippingThreshold: null }).where(eq(schema.stores.id, STORE));
    await d1.db.insert(schema.offers).values({ id: "ship", name: "Ship", discountType: "free_shipping", triggerProductId: "sac", triggerQuantity: 1, rewardQuantity: 0, createdAt: T, updatedAt: T });
    // The offer's free delivery names the product's lines: the coupon has nothing left to cover.
    expect((await quote([{ productId: "sac", quantity: 1 }], { couponCode: "LIVRAISON", destination: HOME })).coupon.reason).toBe("offer_applied");
  });

  it("judges the free-delivery threshold on the subtotal after the coupon", async () => {
    await d1.db.update(schema.stores).set({ freeShippingThreshold: 3000 }).where(eq(schema.stores.id, STORE));
    expect((await quote([{ productId: "robe", quantity: 1 }])).delivery.fee).toBe(0);
    await coupon("DIX");
    const { row } = await quotedThenPlaced([{ productId: "robe", quantity: 1 }], "DIX");
    expect(row).toMatchObject({ price: 2700, deliveryFee: FEE, codAmount: 3300 });
  });
});

describe("whether a coupon applies", () => {
  const refusedEverywhere = async (code: string, refusal: Record<string, unknown>, lines: Line[] = [{ productId: "robe", quantity: 1 }], phone?: string) => {
    expect((await quote(lines, { couponCode: code, destination: HOME, ...(phone ? { phone } : {}) })).coupon).toEqual({ code, applied: false, ...refusal });
    const before = await d1.db.select({ n: sql<number>`count(*)` }).from(schema.orders).get();
    const placed = await order(lines, code, phone);
    expect(placed.status).toBe(422);
    expect(placed.json).toMatchObject({ code: "COUPON_NOT_APPLICABLE", context: refusal });
    expect(await d1.db.select({ n: sql<number>`count(*)` }).from(schema.orders).get()).toEqual(before);
  };

  it("needs a code that exists and is switched on — named in its stored form however it was typed", async () => {
    await refusedEverywhere("NOPE", { reason: "not_found" });
    expect((await quote([{ productId: "robe", quantity: 1 }], { couponCode: " nope 1 ", destination: HOME })).coupon).toEqual({ code: "NOPE1", applied: false, reason: "not_found" });
    expect((await quote([{ productId: "robe", quantity: 1 }], { couponCode: " SALE! ", destination: HOME })).coupon).toEqual({ code: "SALE!", applied: false, reason: "not_found" });
    await coupon("OFF", { status: "inactive" });
    await refusedEverywhere("OFF", { reason: "not_found" });
    expect(await d1.db.select().from(schema.customers).all()).toEqual([]);
  });

  it("applies within its schedule only", async () => {
    await coupon("LATER", { startsAt: "2099-01-01T00:00:00.000Z" });
    await refusedEverywhere("LATER", { reason: "not_started", startsAt: "2099-01-01T00:00:00.000Z" });
    await coupon("PAST", { endsAt: "2000-01-01T00:00:00.000Z" });
    await refusedEverywhere("PAST", { reason: "expired" });
  });

  it("asks the covered lines for its minimum, and says how far short they are", async () => {
    await coupon("MIN", { minSubtotal: 5000 });
    await refusedEverywhere("MIN", { reason: "below_minimum_subtotal", shortBy: 2000 });
    await coupon("TROIS", { minQuantity: 3 });
    await refusedEverywhere("TROIS", { reason: "below_minimum_quantity", shortBy: 1 }, [{ productId: "sac", quantity: 2 }]);
    expect((await quotedThenPlaced([{ productId: "sac", quantity: 3 }], "TROIS")).row.couponDiscount).toBe(300);
  });

  it("stops at its usage limit, and a cancelled order gives its use back", async () => {
    await coupon("DEUX", { usageLimit: 2 });
    await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "DEUX", "0551000001");
    const second = await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "DEUX", "0551000002");
    await refusedEverywhere("DEUX", { reason: "used_up" }, [{ productId: "sac", quantity: 1 }], "0551000003");
    await d1.db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, second.row.id));
    await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "DEUX", "0551000003");
  });

  it("never gives the last use to two orders placed at once", async () => {
    await coupon("DERNIER", { usageLimit: 1 });
    const placed = await Promise.all(["0551000011", "0551000012", "0551000013"].map((phone) => order([{ productId: "sac", quantity: 1 }], "DERNIER", phone)));
    expect(placed.map((entry) => entry.status).sort()).toEqual([201, 422, 422]);
    for (const refused of placed.filter((entry) => entry.status === 422)) expect(refused.json).toMatchObject({ code: "COUPON_NOT_APPLICABLE", context: { reason: "used_up" } });
    expect(await d1.db.select({ n: sql<number>`count(*)` }).from(schema.orders).get()).toEqual({ n: 1 });
  });

  it("gives one use per customer, known by their phone however it is typed", async () => {
    await coupon("UNEFOIS", { oncePerCustomer: true });
    expect((await quote([{ productId: "sac", quantity: 1 }], { couponCode: "UNEFOIS", destination: HOME })).coupon.applied).toBe(true);
    const first = await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "UNEFOIS", "0551000021");
    await refusedEverywhere("UNEFOIS", { reason: "already_used" }, [{ productId: "sac", quantity: 1 }], "+213 551 00 00 21");
    await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "UNEFOIS", "0551000022");
    await d1.db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, first.row.id));
    await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "UNEFOIS", "0551000021");
  });

  it("is for its selected customers and the members of its groups only", async () => {
    await d1.db.insert(schema.customers).values([
      { id: "picked", name: "Picked", phone: "0551000031", wilaya: "Alger", createdAt: T },
      { id: "member", name: "Member", phone: "0551000032", wilaya: "Alger", createdAt: T },
      { id: "other", name: "Other", phone: "0551000033", wilaya: "Alger", createdAt: T },
    ]);
    await d1.db.insert(schema.customerGroups).values({ id: "vip", name: "VIP", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.customerGroupMembers).values({ id: "m1", customerId: "member", groupId: "vip", assignedAt: T });
    await coupon("VIP", { audience: "selected" });
    await d1.db.insert(schema.couponCustomers).values({ couponId: "vip", customerId: "picked" });
    await d1.db.insert(schema.couponCustomerGroups).values({ couponId: "vip", groupId: "vip" });

    expect((await quote([{ productId: "sac", quantity: 1 }], { couponCode: "VIP", destination: HOME })).coupon).toEqual({ code: "VIP", applied: false, reason: "identify_first" });
    await refusedEverywhere("VIP", { reason: "not_eligible" }, [{ productId: "sac", quantity: 1 }], "0551000033");
    await refusedEverywhere("VIP", { reason: "not_eligible" }, [{ productId: "sac", quantity: 1 }], "0551999999");
    expect((await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "VIP", "0551000031")).row.customerId).toBe("picked");
    expect((await quotedThenPlaced([{ productId: "sac", quantity: 1 }], "VIP", "0551000032")).row.customerId).toBe("member");
  });
});

describe("an order without a code", () => {
  it("is placed as ever when the code box was left empty", async () => {
    for (const couponCode of ["", "   "]) {
      expect((await quote([{ productId: "robe", quantity: 1 }], { couponCode, destination: HOME })).coupon).toBeNull();
      const placed = await order([{ productId: "robe", quantity: 1 }], couponCode, couponCode === "" ? "0551000051" : "0551000052");
      expect(placed.status).toBe(201);
      expect((await stored(placed.json.data.orderId)).row).toMatchObject({ couponId: null, couponCode: null, price: 3000 });
    }
  });

  it("is what it always was: no coupon, no discount, and a quote that says nothing of one", async () => {
    await coupon("UNUSED");
    const shown = await quote([{ productId: "robe", quantity: 1 }]);
    expect(shown.coupon).toBeNull();
    expect(shown.lines[0]).toMatchObject({ lineTotal: 3000, discount: 0 });
    const placed = await order([{ productId: "robe", quantity: 1 }]);
    expect(placed.status).toBe(201);
    const { row, lines } = await stored(placed.json.data.orderId);
    expect(row).toMatchObject({ price: 3000, couponId: null, couponCode: null, couponDiscount: 0, codAmount: 3600 });
    expect(lines[0]).toMatchObject({ discount: 0, lineTotal: 3000 });
  });

  it("counts the customer's spend net of the coupon", async () => {
    await coupon("DIX");
    await quotedThenPlaced([{ productId: "robe", quantity: 1 }], "DIX", "0551000041");
    expect(await d1.db.select({ totalSpent: schema.customers.totalSpent }).from(schema.customers).where(eq(schema.customers.phone, "0551000041")).get()).toEqual({ totalSpent: 2700 });
  });
});

describe("the order writer on its own", () => {
  it("refuses an order whose coupon does not apply to it, and writes nothing", async () => {
    await coupon("MIN", { minSubtotal: 5000 });
    const found = await findCheckoutCoupon(d1.db, { code: "MIN", phone: "0551000061", now: new Date().toISOString() });
    if (!found.ok) throw new Error("the coupon should be found");
    const customer = await findOrCreateCustomer(d1.db, { phone: "0551000061", name: "Client", wilayaId: 16 });
    const placing = createStoreOrder(d1.db, {
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      wilayaId: 16,
      communeId: "c-16-001",
      deliveryType: "home",
      deliveryFee: FEE,
      coupon: found.coupon,
      items: [{ productId: "robe", productName: "robe", variantId: null, quantity: 1 }],
    } as never);
    await expect(placing).rejects.toBeInstanceOf(CouponNotApplicableError);
    await expect(placing).rejects.toMatchObject({ refusal: { reason: "below_minimum_subtotal", shortBy: 2000 } });
    expect(await d1.db.select().from(schema.orders).all()).toEqual([]);
    expect((await d1.db.select({ inventory: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, "robe")).get())?.inventory).toBe(50);
  });
});
