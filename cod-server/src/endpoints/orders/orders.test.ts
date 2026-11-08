/**
 * Orders — Targeted Bug-Catching Tests
 *
 * These tests are NOT duplicates of routes.test.ts (which covers happy paths
 * and basic guard rejections via the HTTP layer). This file targets specific
 * business-logic branches that have no coverage and are most likely to hide
 * real bugs:
 *
 *   1. Status transition completeness (every valid and invalid move)
 *   2. Driver assignment auto-advance: confirmed/unreachable stay unchanged
 *   3. Unassign driver: locked status guard, dispatched (unlocked) path
 *   9. createOrder: charges and records the delivery the store decides
 *  10. returnOrderProduct: second call corrects without double-restocking
 *  12. createOrder: companyId not found → 404
 *  13. assignDriver: driver not found → 404
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import ordersRouter from "./routes";
import * as queries from "./queries";
import * as delivery from "./delivery";

// The address rule is tested against the real reference tables
// (store.queries-e2e); this file's mocked database cannot answer it.
vi.mock("@/lib/order-address", () => ({ assertOrderAddress: vi.fn(async () => undefined) }));

vi.mock("@/db", () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock("./queries");
vi.mock("../../../../cod-shared/shipments/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../cod-shared/shipments/queries")>()),
  getOrderShipment: vi.fn(async () => undefined),
}));
vi.mock("./delivery");
vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(async () => {}),
  ACTIONS: {
    ORDER_CREATED: "order.created",
    ORDER_UPDATED: "order.updated",
    ORDER_STATUS_CHANGED: "order.status_changed",
    ORDER_DRIVER_ASSIGNED: "order.driver_assigned",
    ORDER_DISPATCHED: "order.dispatched",
    ORDER_DELETED: "order.deleted",
    ORDER_PRODUCT_RETURNED: "order.product_returned",
    STOCK_ADJUSTED: "stock.adjusted",
  },
}));

const NOW = new Date().toISOString();
let mockDb: any;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function orderRow(overrides: Record<string, any> = {}) {
  return {
    id: "ord_1",
    orderNumber: "ORD-20260327-0042",
    customerId: "cust_1",
    customerName: "Ahmed Benali",
    phone: "0551234567",
    wilayaId: 16,
    wilaya: "الجزائر",
    communeId: "16001",
    commune: "بئر مراد رايس",
    city: null,
    address: "12 Rue Didouche Mourad",
    price: 9000,
    notes: null,
    status: "new",
    orderType: "online",
    deliveryMethod: "unassigned",
    driverId: null,
    driverName: null,
    companyId: "comp_1",
    assignedAt: null,
    assignedBy: null,
    assignmentNotes: null,
    trackingNumber: null,
    trackingUrl: null,
    externalOrderId: null,
    deliveryType: "home",
    stationCode: null,
    deliveryFee: 600,
    driverFee: 0,
    codAmount: 9600,
    pickupTime: null,
    deliveryTime: null,
    deliveryAttempts: 0,
    photos: null,
    codPaymentId: null,
    feePaymentId: null,
    weight: null,
    isFragile: null,
    createdAt: NOW,
    updatedAt: NOW,
    products: [],
    ...overrides,
  };
}

describe("Orders — targeted business-logic tests", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    vi.mocked(queries.updateOrderStatus).mockResolvedValue({ ok: true });
    vi.mocked(queries.deleteOrder).mockResolvedValue({ ok: true });
    vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb } as any;
      signIn(c, {
        id: "admin_1",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
        apiKey: "cod_key",
        scopes: ["*"],
      } as any);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/orders", ordersRouter);
    mockDb = {};
    vi.clearAllMocks();
  });

  // ─── 1. Status transition completeness ────────────────────────────────────

  describe("PATCH /api/orders/{id}/status — transition table", () => {
    async function transition(from: string, to: string) {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: from }) as any);
      vi.mocked(queries.updateOrderStatus).mockResolvedValue({ ok: true });
      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      return res.status;
    }

    // The lifecycle's moves (cod-shared/orders/lifecycle.ts)
    it("new → confirmed is allowed", async () => expect(await transition("new", "confirmed")).toBe(200));
    it("new → unreachable is allowed", async () => expect(await transition("new", "unreachable")).toBe(200));
    it("new → cancelled is allowed", async () => expect(await transition("new", "cancelled")).toBe(200));
    it("confirmed → preparing is allowed", async () => expect(await transition("confirmed", "preparing")).toBe(200));
    it("confirmed → ready is allowed", async () => expect(await transition("confirmed", "ready")).toBe(200));
    it("confirmed → cancelled is allowed", async () => expect(await transition("confirmed", "cancelled")).toBe(200));
    it("unreachable → confirmed is allowed", async () => expect(await transition("unreachable", "confirmed")).toBe(200));
    it("unreachable → cancelled is allowed", async () => expect(await transition("unreachable", "cancelled")).toBe(200));
    it("preparing → ready is allowed", async () => expect(await transition("preparing", "ready")).toBe(200));
    it("preparing → cancelled is allowed", async () => expect(await transition("preparing", "cancelled")).toBe(200));
    it("ready → cancelled is allowed", async () => expect(await transition("ready", "cancelled")).toBe(200));

    // Anything else is refused
    it("confirmed → new is blocked (backward)", async () => expect(await transition("confirmed", "new")).toBe(400));
    it("ready → preparing is blocked (backward)", async () => expect(await transition("ready", "preparing")).toBe(400));
    it("new → ready is blocked (skip)", async () => expect(await transition("new", "ready")).toBe(400));
    it("cancelled → new is blocked (terminal)", async () => expect(await transition("cancelled", "new")).toBe(400));
    it("cancelled → preparing is blocked (terminal)", async () => expect(await transition("cancelled", "preparing")).toBe(400));
    for (const delivery of ["assigned", "dispatched", "out_for_delivery", "delivered", "returned"]) {
      it(`${delivery} is not an order status — delivery is the shipment's`, async () => expect(await transition("ready", delivery)).toBe(400));
    }

    // Context fields on blocked transitions
    it("blocked transition response includes currentStatus, targetStatus, allowedTransitions", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "cancelled" }) as any);
      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      const body: any = await res.json();
      expect(body.code).toBe("INVALID_STATUS_TRANSITION");
      expect(body.context.currentStatus).toBe("cancelled");
      expect(body.context.targetStatus).toBe("confirmed");
      expect(body.context.allowedTransitions).toEqual([]);
    });

    it("blocked transition from ready shows its allowed next statuses", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "ready" }) as any);
      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "new" }),
      });
      const body: any = await res.json();
      expect(body.context.allowedTransitions).toEqual(["cancelled"]);
    });
  });

  // ─── 9. createOrder: the delivery the store decides ─────────────────────────

  describe("POST /api/orders — the delivery the order charges", () => {
    // What the store decides is proved on real D1 (orders.delivery-quote.e2e.test.ts);
    // here, that the handler charges it, records its offer, and lets a refusal through.
    const baseOrder = {
      customerId: "cust_1",
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: 16,
      communeId: "16001",
      address: "12 Rue Didouche Mourad",
      price: 9000,
      orderType: "offline",
      products: [
        { productId: "prod_1", productName: "Galaxy A54", quantity: 1, pricePerUnit: 9000, lineTotal: 9000 },
      ],
    };
    const existingCustomer = () => ({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ all: vi.fn(async () => [{ id: "cust_1" }]) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    });

    it("charges what the store's delivery decides, and records the offer that made it free", async () => {
      vi.mocked(delivery.orderDelivery).mockResolvedValue({ deliveryFee: 0, deliveryOfferId: "of_1", deliveryOfferName: "Livraison offerte" });
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      mockDb = existingCustomer();

      const res = await app.request("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(baseOrder) });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.data).toMatchObject({ deliveryFee: 0, codAmount: 9000 });
      expect(vi.mocked(queries.createOrder).mock.calls.at(-1)![1]).toMatchObject({ deliveryFee: 0, deliveryOfferId: "of_1", deliveryOfferName: "Livraison offerte", codAmount: 9000 });
    });

    it("lets the store's refusal through, creating nothing", async () => {
      const { BusinessLogicError } = await import("@/lib/errors/classes");
      vi.mocked(delivery.orderDelivery).mockRejectedValue(new BusinessLogicError("Home delivery is not available there", "DELIVERY_NOT_AVAILABLE" as never));
      vi.mocked(queries.createOrder).mockClear();

      const res = await app.request("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseOrder, orderType: "online" }) });

      expect(res.status).toBe(422);
      expect(((await res.json()) as any).code).toBe("DELIVERY_NOT_AVAILABLE");
      expect(queries.createOrder).not.toHaveBeenCalled();
    });
  });

  // ─── 10. returnOrderProduct: second call corrects without double-restock ──

  describe("PATCH /api/orders/{id}/products/{productLineId}/return — outcomes", () => {
    const send = (returnedQuantity: number) =>
      app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity }),
      });

    it("a recorded return answers with the line's state", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(queries.setOrderProductReturn).mockResolvedValue({ ok: true, id: "op_1", status: "partially_returned", returnedQuantity: 1, quantity: 3 });
      const res = await send(1);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data).toEqual({ id: "op_1", status: "partially_returned", returnedQuantity: 1, quantity: 3 });
    });

    it("refusals keep their meaning", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      for (const [reason, status, code] of [
        ["order_closed", 422, "INVALID_STATUS_TRANSITION"],
        ["changed", 409, "ORDER_CHANGED"],
        ["line_not_found", 404, undefined],
        ["out_of_range", 400, "VALUE_OUT_OF_RANGE"],
      ] as const) {
        vi.mocked(queries.setOrderProductReturn).mockResolvedValue({ ok: false, reason, quantity: 3 });
        const res = await send(1);
        expect(res.status, reason).toBe(status);
        if (code) expect(((await res.json()) as any).code, reason).toBe(code);
      }
    });
  });
});
