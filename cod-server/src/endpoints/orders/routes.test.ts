/**
 * Route-level integration tests for Orders OpenAPIHono router
 * (CRUD, lifecycle transitions, carrier dispatch guards, shipment ops).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import ordersRouter from "./routes";
import * as queries from "./queries";
import * as resolveFee from "./resolve-fee";
import { ValidationError } from "@/lib/errors/classes";
import { assertOrderAddress } from "@/lib/order-address";

// The address rule is tested against the real reference tables
// (store.queries-e2e); this file's mocked database cannot answer it.
vi.mock("@/lib/order-address", () => ({ assertOrderAddress: vi.fn(async () => undefined) }));

vi.mock("@/db", () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock("./queries");
vi.mock("../../../../cod-shared/shipments/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../cod-shared/shipments/queries")>()),
  getOrderShipment: vi.fn(async () => undefined),
}));
vi.mock("./resolve-fee");
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
vi.mock("@/workflows/capi-helpers", () => ({
  shouldTriggerCapiPurchase: vi.fn(() => false),
  shouldTriggerCapiConfirmed: vi.fn(() => false),
  getCapiWorkflowId: vi.fn((id: string, stage: string, event: string) => `capi-${id}-${stage}-${event}`),
  resolveConversionForStage: vi.fn(() => ({ shouldFire: false })),
  resolveCapiDispatch: vi.fn(() => ({ send: false, reason: "tracking-disabled", message: "mock skip" })),
}));
vi.mock("@/endpoints/delivery-companies/queries", () => ({
  getDeliveryCompanyById: vi.fn(async () => ({ id: "comp_1", name: "NOEST" })),
  getDeliveryCompanyRaw: vi.fn(async () => ({
    id: "comp_1",
    name: "NOEST",
    code: "noest",
    active: true,
    apiEndpoint: "https://noest.test",
    apiToken: "tok",
  })),
}));

const NOW = new Date().toISOString();

let mockDb: any;

function dbSelectReturning(result: any) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(async () => result),
          all: vi.fn(async () => (Array.isArray(result) ? result : result ? [result] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  };
}

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
    ...overrides,
  };
}

describe("Orders routes (OpenAPIHono)", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    vi.mocked(queries.updateOrderStatus).mockResolvedValue({ ok: true });
    vi.mocked(queries.deleteOrder).mockResolvedValue({ ok: true });
    vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb } as any;
      c.set("user", {
        id: "admin_user_001",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
        apiKey: "cod_admin_key",
        scopes: ["*"],
      } as any);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/orders", ordersRouter);
    mockDb = {};
    vi.clearAllMocks();
  });

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  describe("GET /api/orders", () => {
    it("returns 200 with orders and count", async () => {
      vi.mocked(queries.getAllOrders).mockResolvedValue([orderRow()] as any);

      const res = await app.request("/api/orders");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.count).toBe(1);
      expect(body.data[0].orderNumber).toBe("ORD-20260327-0042");
    });

    it("passes filters through to the query", async () => {
      vi.mocked(queries.getAllOrders).mockResolvedValue([] as any);

      const res = await app.request("/api/orders?status=ready&stage=in_transit&attention=false&limit=10");

      expect(res.status).toBe(200);
      expect(queries.getAllOrders).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ status: "ready", stage: "in_transit", attention: false, limit: 10 })
      );
    });

    it("returns 400 for an unknown status filter", async () => {
      const res = await app.request("/api/orders?status=bogus");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/orders/{id}", () => {
    it("returns 200 with detail including products and history", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({
          products: [{ id: "op_1", orderId: "ord_1", status: "fulfilled" }],
          statusHistory: [{ id: "h1", orderId: "ord_1", status: "new", timestamp: NOW }],
        }) as any
      );

      const res = await app.request("/api/orders/ord_1");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(Array.isArray(body.data.products)).toBe(true);
      expect(Array.isArray(body.data.statusHistory)).toBe(true);
    });

    it("returns 404 when the order does not exist", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(null as any);

      const res = await app.request("/api/orders/missing");

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.code).toBe("ORDER_NOT_FOUND");
    });
  });

  describe("POST /api/orders", () => {
    const validOrder = {
      customerId: "cust_1",
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: 16,
      communeId: "16001",
      address: "12 Rue Didouche Mourad",
      price: 9000,
      products: [
        { productId: "prod_1", productName: "Galaxy A54", quantity: 1, pricePerUnit: 9000, lineTotal: 9000 },
      ],
    };

    it("creates an order and returns computed COD amount with 201", async () => {
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      vi.mocked(resolveFee.resolveDeliveryFee).mockResolvedValue({ deliveryFee: 600 } as any);
      vi.mocked(resolveFee.applyFreeShippingOffer).mockResolvedValue(600);
      mockDb = dbSelectReturning({ id: "cust_1" }); // existing customer

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validOrder),
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.data.codAmount).toBe(9600);
      expect(body.data.orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);
    });

    it("requires address for home delivery (superRefine)", async () => {
      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validOrder, address: undefined }),
      });

      expect(res.status).toBe(400);
    });

    /**
     * A phone order can carry an email too — receipts today, digital delivery
     * later. It stays OPTIONAL here no matter what the storefront's Checkout
     * Form Policy says: that policy is about what shoppers are asked, and staff
     * on a call either have the address or they do not. Requiring it would only
     * produce invented ones.
     */
    it("stores a normalised email when staff enter one", async () => {
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      vi.mocked(resolveFee.resolveDeliveryFee).mockResolvedValue({ deliveryFee: 600 } as any);
      vi.mocked(resolveFee.applyFreeShippingOffer).mockResolvedValue(600);
      mockDb = dbSelectReturning({ id: "cust_1" });

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validOrder, customerEmail: "  Shopper@Example.COM " }),
      });

      expect(res.status).toBe(201);
      // Same canonical form the storefront writes, so one customer's address is
      // one string in the column however the order was taken.
      expect(vi.mocked(queries.createOrder).mock.calls.at(-1)?.[1]).toMatchObject({
        customerEmail: "shopper@example.com",
      });
    });

    it("creates an order without one — every phone order taken today", async () => {
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      vi.mocked(resolveFee.resolveDeliveryFee).mockResolvedValue({ deliveryFee: 600 } as any);
      vi.mocked(resolveFee.applyFreeShippingOffer).mockResolvedValue(600);
      mockDb = dbSelectReturning({ id: "cust_1" });

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validOrder),
      });

      expect(res.status).toBe(201);
      expect(vi.mocked(queries.createOrder).mock.calls.at(-1)?.[1]).toMatchObject({
        customerEmail: null,
      });
    });

    it("treats an empty email box as no email, not as a value", async () => {
      // A form always submits its inputs; an untouched box must not become "".
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      vi.mocked(resolveFee.resolveDeliveryFee).mockResolvedValue({ deliveryFee: 600 } as any);
      vi.mocked(resolveFee.applyFreeShippingOffer).mockResolvedValue(600);
      mockDb = dbSelectReturning({ id: "cust_1" });

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validOrder, customerEmail: "   " }),
      });

      expect(res.status).toBe(201);
      expect(vi.mocked(queries.createOrder).mock.calls.at(-1)?.[1]).toMatchObject({
        customerEmail: null,
      });
    });

    it("rejects a malformed email rather than storing it", async () => {
      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validOrder, customerEmail: "not-an-email" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects a non-Algerian phone number", async () => {
      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validOrder, phone: "12345" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/orders/{id}", () => {
    it("deletes an existing order", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(queries.deleteOrder).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1", { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(queries.deleteOrder).toHaveBeenCalledWith(mockDb, "ord_1");
    });

    it("returns 404 when deleting a missing order", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(null as any);

      const res = await app.request("/api/orders/missing", { method: "DELETE" });

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/orders/{id}", () => {
    const patch = {
      customerName: "Ahmed Benali",
      phone: "0661234567",
      address: "45 Boulevard Front de Mer",
    };

    it("updates the order and returns the refreshed detail", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.orderNumber).toBe("ORD-20260327-0042");
      expect(queries.updateOrder).toHaveBeenCalledWith(
        mockDb,
        "ord_1",
        expect.objectContaining({ customerName: "Ahmed Benali", phone: "0661234567" })
      );
    });

    it("normalises the email and treats an empty address box as a clear", async () => {
      // stop_desk: clearing the address is legal here, so the preprocess
      // (whitespace → null) is observable without tripping MISSING_ADDRESS.
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ deliveryType: "stop_desk", address: "Old address" }) as any
      );
      vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerEmail: "  Shopper@Example.COM ", address: "   " }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(queries.updateOrder).mock.calls.at(-1)?.[2]).toMatchObject({
        customerEmail: "shopper@example.com",
        address: null,
      });
    });

    it("records an address on an order the checkout shipped without one", async () => {
      // The whole point of the checkout-form-policy flow: an address-less home
      // order accepts an address (and only an address-adding edit) later.
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ address: null }) as any
      );
      vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "Cité 200 logements, Birtouta" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateOrder).toHaveBeenCalled();
    });

    it("returns 400 MISSING_ADDRESS when the edit empties a home order's address", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "   " }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.MISSING_ADDRESS);
    });

    it("returns 400 MISSING_ADDRESS when switching to home without any address", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ deliveryType: "stop_desk", address: null }) as any
      );

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryType: "home" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.MISSING_ADDRESS);
    });

    it("lets a notes-only edit pass on an address-less home order", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ address: null }) as any
      );
      vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Call before delivery" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateOrder).toHaveBeenCalledWith(
        mockDb,
        "ord_1",
        expect.objectContaining({ notes: "Call before delivery" })
      );
    });

    it("checks wilaya and commune against the reference tables", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(queries.updateOrder).mockResolvedValue({ ok: true });
      mockDb = dbSelectReturning({ id: "c-16-001", wilayaId: 16 });

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wilayaId: 16, communeId: "c-16-001" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateOrder).toHaveBeenCalled();
    });

    it("returns 400 for a commune outside the selected wilaya", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(assertOrderAddress).mockRejectedValueOnce(
        new ValidationError("Commune does not belong to the selected wilaya", ERROR_CODES.MISSING_WILAYA_COMMUNE)
      );

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wilayaId: 16, communeId: "c-31-001" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.MISSING_WILAYA_COMMUNE);
      expect(vi.mocked(assertOrderAddress)).toHaveBeenCalledWith(
        expect.anything(),
        { wilayaId: 16, communeId: "c-31-001" },
        { orderId: "ord_1" },
      );
    });

    it("returns 422 on a terminal (cancelled) order", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ status: "cancelled" }) as any
      );

      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.INVALID_STATUS_TRANSITION);
    });

    it("returns 404 when the order does not exist", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(null as any);

      const res = await app.request("/api/orders/missing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      expect(res.status).toBe(404);
    });

    it("rejects a non-Algerian phone number with 400", async () => {
      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "12345" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects a malformed email with 400", async () => {
      const res = await app.request("/api/orders/ord_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerEmail: "not-an-email" }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe("PATCH /api/orders/{id}/status", () => {
    it("applies a valid forward transition", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "confirmed" }) as any);
      vi.mocked(queries.updateOrderStatus).mockResolvedValue({ ok: true });

      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "preparing" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateOrderStatus).toHaveBeenCalledWith(
        mockDb, "ord_1", "preparing", "admin_user_001", "Admin User"
      );
    });

    it("blocks an invalid backward transition with 400 INVALID_STATUS_TRANSITION", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "delivered" }) as any);

      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "new" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe("INVALID_STATUS_TRANSITION");
      expect(body.context.allowedTransitions).toEqual([]);
    });
  });

  describe("PATCH /api/orders/{id}/products/{productLineId}/return", () => {
    it("records a return and reports derived status", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      vi.mocked(queries.setOrderProductReturn).mockResolvedValue({
        returnedQuantity: 1,
        status: "partially_returned",
      } as any);

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 1 }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.status).toBe("partially_returned");
    });

    it("returns 422 on a terminal-state order", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "cancelled" }) as any);

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 1 }),
      });

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.INVALID_STATUS_TRANSITION);
    });
  });
});
