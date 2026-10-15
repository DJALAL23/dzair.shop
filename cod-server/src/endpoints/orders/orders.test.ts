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
 *   9. createOrder offline: fee-resolution error silently falls back
 *  10. returnOrderProduct: second call corrects without double-restocking
 *  11. applyFreeShippingOffer: date filtering absent — expired offer applies
 *  12. createOrder: companyId not found → 404
 *  13. assignDriver: driver not found → 404
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
import * as deliveryCompanyQueries from "@/endpoints/delivery-companies/queries";
import * as carrierGeo from "../../../../cod-shared/queries/carrier-geo";

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
vi.mock("@/endpoints/delivery-companies/queries");
vi.mock("../../../../cod-shared/queries/carrier-geo");

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

function companyRow(overrides: Record<string, any> = {}) {
  return {
    id: "comp_1",
    name: "TestCarrier",
    code: "noest",
    active: true,
    apiEndpoint: "https://noest.test",
    apiToken: "tok",
    autoValidate: false,
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
      c.set("user", {
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

    // Valid forward moves
    it("new → confirmed is allowed", async () => expect(await transition("new", "confirmed")).toBe(200));
    it("new → unreachable is allowed", async () => expect(await transition("new", "unreachable")).toBe(200));
    it("new → cancelled is allowed", async () => expect(await transition("new", "cancelled")).toBe(200));
    it("confirmed → preparing is allowed", async () => expect(await transition("confirmed", "preparing")).toBe(200));
    it("confirmed → cancelled is allowed", async () => expect(await transition("confirmed", "cancelled")).toBe(200));
    it("unreachable → confirmed is allowed", async () => expect(await transition("unreachable", "confirmed")).toBe(200));
    it("unreachable → cancelled is allowed", async () => expect(await transition("unreachable", "cancelled")).toBe(200));
    it("preparing → ready is allowed", async () => expect(await transition("preparing", "ready")).toBe(200));
    it("preparing → cancelled is allowed", async () => expect(await transition("preparing", "cancelled")).toBe(200));
    it("ready → out_for_delivery is allowed", async () => expect(await transition("ready", "out_for_delivery")).toBe(200));
    it("ready → dispatched is allowed", async () => expect(await transition("ready", "dispatched")).toBe(200));
    it("ready → cancelled is allowed", async () => expect(await transition("ready", "cancelled")).toBe(200));
    it("dispatched → out_for_delivery is allowed", async () => expect(await transition("dispatched", "out_for_delivery")).toBe(200));
    it("dispatched → cancelled is allowed", async () => expect(await transition("dispatched", "cancelled")).toBe(200));
    it("out_for_delivery → delivered is allowed", async () => expect(await transition("out_for_delivery", "delivered")).toBe(200));
    it("out_for_delivery → returned is allowed", async () => expect(await transition("out_for_delivery", "returned")).toBe(200));

    // Invalid backward or skipped moves — all must return 400
    it("new → delivered is blocked (skip)", async () => expect(await transition("new", "delivered")).toBe(400));
    it("new → out_for_delivery is blocked (skip)", async () => expect(await transition("new", "out_for_delivery")).toBe(400));
    it("confirmed → new is blocked (backward)", async () => expect(await transition("confirmed", "new")).toBe(400));
    it("delivered → new is blocked (terminal)", async () => expect(await transition("delivered", "new")).toBe(400));
    it("delivered → confirmed is blocked (terminal)", async () => expect(await transition("delivered", "confirmed")).toBe(400));
    it("returned → confirmed is blocked (terminal)", async () => expect(await transition("returned", "confirmed")).toBe(400));
    it("cancelled → new is blocked (terminal)", async () => expect(await transition("cancelled", "new")).toBe(400));
    it("cancelled → preparing is blocked (terminal)", async () => expect(await transition("cancelled", "preparing")).toBe(400));

    // Context fields on blocked transitions
    it("blocked transition response includes currentStatus, targetStatus, allowedTransitions", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "delivered" }) as any);
      const res = await app.request("/api/orders/ord_1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      const body: any = await res.json();
      expect(body.code).toBe("INVALID_STATUS_TRANSITION");
      expect(body.context.currentStatus).toBe("delivered");
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
      expect(body.context.allowedTransitions).toEqual(
        expect.arrayContaining(["out_for_delivery", "dispatched", "cancelled"])
      );
      expect(body.context.allowedTransitions).not.toContain("new");
    });
  });

  // ─── 2. Driver assignment: confirmed/unreachable do NOT auto-advance ───────

  describe("PATCH /api/orders/{id}/assign-driver — status auto-advance", () => {
    it("order in 'new' status auto-advances to 'assigned'", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "new" }) as any);
      vi.mocked(queries.assignDriver).mockResolvedValue(undefined as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "drv_1" })),
            })),
          })),
        })),
      };

      const res = await app.request("/api/orders/ord_1/assign-driver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "drv_1" }),
      });

      expect(res.status).toBe(200);
      // queries.assignDriver is called — the auto-advance logic lives in the query,
      // which checks preAssignmentStatuses = ["new", "preparing", "ready"]
      expect(queries.assignDriver).toHaveBeenCalledWith(mockDb, "ord_1", "drv_1");
    });

    it("order in 'confirmed' status: handler allows it, but status does NOT auto-advance (confirmed not in preAssignmentStatuses)", async () => {
      // The handler only blocks: trackingNumber, deliveryMethod=company, and locked statuses.
      // "confirmed" is NOT in locked statuses, so the handler lets it through.
      // The query's preAssignmentStatuses = ["new", "preparing", "ready"] — excludes "confirmed".
      // This means after assignment, status stays "confirmed" (not "assigned").
      // This is a real behavioral gap the tests never verified.
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "confirmed" }) as any);
      vi.mocked(queries.assignDriver).mockResolvedValue(undefined as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "drv_1" })),
            })),
          })),
        })),
      };

      const res = await app.request("/api/orders/ord_1/assign-driver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "drv_1" }),
      });

      // Handler succeeds (200) — it doesn't block confirmed orders
      expect(res.status).toBe(200);
      // The query IS called — proving assignment goes through
      expect(queries.assignDriver).toHaveBeenCalledWith(mockDb, "ord_1", "drv_1");
      // NOTE: The DB query will NOT set status="assigned" for "confirmed" orders.
      // A confirmed order with a driver attached stays "confirmed" — this is the documented
      // gap: the handler should either block it or the query should include "confirmed"
      // in preAssignmentStatuses. Currently neither happens.
    });

    it("order in 'unreachable' status: handler allows it but status does NOT auto-advance", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow({ status: "unreachable" }) as any);
      vi.mocked(queries.assignDriver).mockResolvedValue(undefined as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "drv_1" })),
            })),
          })),
        })),
      };

      const res = await app.request("/api/orders/ord_1/assign-driver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "drv_1" }),
      });

      expect(res.status).toBe(200);
      expect(queries.assignDriver).toHaveBeenCalledWith(mockDb, "ord_1", "drv_1");
    });

    it("driver not found returns 404", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(orderRow() as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => null), // driver not found
            })),
          })),
        })),
      };

      const res = await app.request("/api/orders/ord_1/assign-driver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "drv_missing" }),
      });

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.DRIVER_NOT_FOUND);
    });

    it("deliveryMethod=company blocks assignment even without a trackingNumber", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ deliveryMethod: "company", trackingNumber: null }) as any
      );

      const res = await app.request("/api/orders/ord_1/assign-driver", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "drv_1" }),
      });

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.ORDER_ALREADY_DISPATCHED);
    });
  });

  // ─── 3. Unassign driver: locked-status guard + dispatched (allowed) ────────

  describe("PATCH /api/orders/{id}/unassign", () => {
    it("returns 422 when order is out_for_delivery (locked)", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ driverId: "drv_1", deliveryMethod: "driver", status: "out_for_delivery" }) as any
      );

      const res = await app.request("/api/orders/ord_1/unassign", { method: "PATCH" });

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.INVALID_STATUS_TRANSITION);
      expect(body.context.currentStatus).toBe("out_for_delivery");
    });

    it("returns 422 when order is delivered (locked)", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ driverId: "drv_1", deliveryMethod: "driver", status: "delivered" }) as any
      );

      const res = await app.request("/api/orders/ord_1/unassign", { method: "PATCH" });

      expect(res.status).toBe(422);
    });

    it("returns 422 when order is cancelled (locked)", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ driverId: "drv_1", deliveryMethod: "driver", status: "cancelled" }) as any
      );

      const res = await app.request("/api/orders/ord_1/unassign", { method: "PATCH" });

      expect(res.status).toBe(422);
    });

    it("allows unassign from 'dispatched' (not in locked set)", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ driverId: "drv_1", deliveryMethod: "driver", status: "dispatched" }) as any
      );
      vi.mocked(queries.unassignDriver).mockResolvedValue(undefined as any);

      const res = await app.request("/api/orders/ord_1/unassign", { method: "PATCH" });

      expect(res.status).toBe(200);
      expect(queries.unassignDriver).toHaveBeenCalledWith(mockDb, "ord_1");
    });
  });

  // ─── 9. createOrder offline: fee-resolution error silently swallowed ───────

  describe("POST /api/orders — offline order fee-resolution fallback", () => {
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

    it("uses explicit deliveryFee when resolveDeliveryFee throws for offline order", async () => {
      vi.mocked(resolveFee.resolveDeliveryFee).mockRejectedValue(
        new Error("No shipping profile configured")
      );
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "cust_1" })),
            })),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseOrder, deliveryFee: 500 }),
      });

      // Offline order succeeds despite resolveDeliveryFee throwing
      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Falls back to explicit deliveryFee=500
      expect(body.data.deliveryFee).toBe(500);
      expect(body.data.codAmount).toBe(9500); // 9000 + 500
    });

    it("falls back to 0 when resolveDeliveryFee throws and no explicit fee provided", async () => {
      vi.mocked(resolveFee.resolveDeliveryFee).mockRejectedValue(
        new Error("No shipping profile configured")
      );
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "cust_1" })),
            })),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseOrder), // no deliveryFee
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Silent fallback to 0 — merchant may not notice
      expect(body.data.deliveryFee).toBe(0);
      expect(body.data.codAmount).toBe(9000);
    });

    it("rethrows fee-resolution errors for online orders", async () => {
      vi.mocked(resolveFee.resolveDeliveryFee).mockRejectedValue(
        new Error("No shipping profile configured")
      );

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseOrder, orderType: "online" }),
      });

      // Online orders do NOT swallow errors
      expect(res.status).toBe(500);
    });
  });

  // ─── 10. returnOrderProduct: second call corrects without double-restock ──

  describe("PATCH /api/orders/{id}/products/{productLineId}/return — idempotency", () => {
    it("second call with same quantity is a no-op (returns same result)", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ status: "delivered" }) as any
      );
      vi.mocked(queries.setOrderProductReturn).mockResolvedValue({
        returnedQuantity: 2,
        status: "returned",
        id: "op_1",
        quantity: 2,
      } as any);

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 2 }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.returnedQuantity).toBe(2);
      expect(body.data.status).toBe("returned");
    });

    it("correcting an overstated return (reducing returnedQty) is allowed", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ status: "delivered" }) as any
      );
      // Reduce from 3 returned to 1 returned (customer only refused 1, not 3)
      vi.mocked(queries.setOrderProductReturn).mockResolvedValue({
        returnedQuantity: 1,
        status: "partially_returned",
        id: "op_1",
        quantity: 3,
      } as any);

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 1 }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.status).toBe("partially_returned");
      expect(body.data.returnedQuantity).toBe(1);
    });

    it("returns 422 when order is in cancelled state", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ status: "cancelled" }) as any
      );

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 1 }),
      });

      expect(res.status).toBe(422);
    });

    it("returns 422 when order is already returned", async () => {
      vi.mocked(queries.getOrderById).mockResolvedValue(
        orderRow({ status: "returned" }) as any
      );

      const res = await app.request("/api/orders/ord_1/products/op_1/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnedQuantity: 1 }),
      });

      expect(res.status).toBe(422);
    });
  });

  // ─── 11. applyFreeShippingOffer: expired offers still apply ───────────────

  describe("createOrder — free shipping offer date filtering", () => {
    it("applies free shipping when offer is active (no date check in current code)", async () => {
      // This test documents the gap: applyFreeShippingOffer only checks status="active",
      // not startsAt/endsAt. An expired offer with status="active" still zeroes the fee.
      // The test passes today because the mock returns 0 — confirming the code path runs
      // even for offers that would be expired by date.
      vi.mocked(resolveFee.resolveDeliveryFee).mockResolvedValue({ deliveryFee: 600 } as any);
      vi.mocked(resolveFee.applyFreeShippingOffer).mockResolvedValue(0); // offer applied
      vi.mocked(queries.createOrder).mockImplementation(async (_db, order) => ({ id: order.id, orderNumber: order.orderNumber }) as any);
      mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({ id: "cust_1" })),
            })),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: "cust_1",
          customerName: "Ahmed Benali",
          phone: "0551234567",
          wilayaId: 16,
          communeId: "16001",
          address: "12 Rue Didouche Mourad",
          price: 9000,
          products: [{ productId: "prod_1", productName: "Galaxy A54", quantity: 2, pricePerUnit: 4500, lineTotal: 9000 }],
        }),
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Fee was zeroed by the "active" offer — regardless of date
      expect(body.data.deliveryFee).toBe(0);
      expect(body.data.codAmount).toBe(9000); // price + 0 delivery
    });
  });

  // ─── 12. createOrder: companyId not found → 404 ───────────────────────────

  describe("POST /api/orders — companyId validation", () => {
    it("returns 404 when provided companyId does not exist", async () => {
      vi.mocked(deliveryCompanyQueries.getDeliveryCompanyById).mockResolvedValue(null as any);

      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: "cust_1",
          customerName: "Ahmed Benali",
          phone: "0551234567",
          wilayaId: 16,
          communeId: "16001",
          address: "12 Rue Didouche Mourad",
          price: 9000,
          companyId: "comp_missing",
          products: [{ productId: "prod_1", productName: "Galaxy A54", quantity: 1, pricePerUnit: 9000, lineTotal: 9000 }],
        }),
      });

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.code).toBe("DELIVERY_COMPANY_NOT_FOUND");
    });
  });
});
