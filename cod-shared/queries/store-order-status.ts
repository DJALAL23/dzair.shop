/**
 * Where a shopper's order is, as the shopper may see it.
 *
 * A shopper has no account: the order's number and the phone it was placed
 * with prove it is theirs, as for a review (`store-reviews.ts`). A wrong
 * number and a wrong phone answer the same, so nobody learns which orders
 * exist. The answer is what the shopper already knows or is waiting for — the
 * step it is at, what they ordered, what they will pay, and the carrier's
 * tracking number once it is on its way — never the address, the notes or the
 * merchant's own statuses.
 */
import { asc, eq } from "drizzle-orm";
import { deliveryCompanies, orderProducts, orders, shipments } from "../db/schema";
import type { AppDb } from "../db/client";
import { samePhone } from "../lib/phone";
import { orderStage } from "../orders/stage";
import { shopperOrderStage, type ShopperOrderStage } from "../orders/shopper-stage";
import type { OrderStatus } from "../orders/lifecycle";

export interface ShopperOrderLine {
  /** As it was sold, in the catalog's language. */
  name: string;
  variantLabel: string | null;
  quantity: number;
}

export interface ShopperOrderStatus {
  orderNumber: string;
  placedAt: string;
  stage: ShopperOrderStage;
  deliveryType: "home" | "stop_desk";
  lines: ShopperOrderLine[];
  /** What the shopper pays on delivery: the order and its delivery. */
  total: number;
  /** The carrier's tracking number once the parcel is with it; null before, or with the store's own driver. */
  tracking: { number: string; carrier: string | null } | null;
}

export async function findShopperOrder(db: AppDb, proof: { orderNumber: string; phone: string }): Promise<ShopperOrderStatus | null> {
  const orderNumber = proof.orderNumber.trim().toUpperCase();
  const found = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      phone: orders.phone,
      status: orders.status,
      deliveryType: orders.deliveryType,
      total: orders.codAmount,
      placedAt: orders.createdAt,
      kind: shipments.kind,
      handoffState: shipments.handoffState,
      trackingNumber: shipments.trackingNumber,
      outForDeliveryAt: shipments.outForDeliveryAt,
      deliveredAt: shipments.deliveredAt,
      returnStartedAt: shipments.returnStartedAt,
      returnedAt: shipments.returnedAt,
      cancelledAt: shipments.cancelledAt,
      attentionSince: shipments.attentionSince,
      carrier: deliveryCompanies.name,
    })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, shipments.companyId))
    .where(eq(orders.orderNumber, orderNumber))
    .get();
  if (!found || !samePhone(found.phone, proof.phone)) return null;

  const shipment =
    found.handoffState === null
      ? null
      : {
          handoffState: found.handoffState,
          outForDeliveryAt: found.outForDeliveryAt,
          deliveredAt: found.deliveredAt,
          returnStartedAt: found.returnStartedAt,
          returnedAt: found.returnedAt,
          cancelledAt: found.cancelledAt,
          attentionSince: found.attentionSince,
        };
  const lines = await db
    .select({ name: orderProducts.productName, variantLabel: orderProducts.variantLabel, quantity: orderProducts.quantity })
    .from(orderProducts)
    .where(eq(orderProducts.orderId, found.id))
    .orderBy(asc(orderProducts.createdAt), asc(orderProducts.id))
    .all();

  const withCarrier = found.kind === "carrier" && found.handoffState === "accepted" && found.trackingNumber;
  return {
    orderNumber: found.orderNumber,
    placedAt: found.placedAt,
    stage: shopperOrderStage(orderStage(found.status as OrderStatus, shipment)),
    deliveryType: found.deliveryType,
    lines,
    total: found.total,
    tracking: withCarrier ? { number: found.trackingNumber!, carrier: found.carrier ?? null } : null,
  };
}
