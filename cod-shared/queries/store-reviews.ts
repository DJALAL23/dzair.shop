/**
 * Reviews as the storefront meets them: who may write one, and what is shown.
 *
 * A shopper has no account. What proves they bought is their order: its
 * number and the phone it was placed with — the number alone is guessable
 * (`ORD-<day>-<4 digits>`), the phone is not. They may review a product once
 * the order reached them (its shipment delivered), once per product of it,
 * and only a product they kept: a line refused in full at the door does not
 * count. A wrong number and a wrong phone answer the same, so nobody can find
 * out which orders exist.
 */
import { eq, sql } from "drizzle-orm";
import { orders, shipments } from "../db/schema";
import type { AppDb } from "../db/client";
import { samePhone } from "../lib/phone";

export interface ReviewableProduct {
  productId: string;
  name: string;
  imageSrc: string | null;
  /** Already reviewed from this order: it cannot be reviewed again. */
  reviewed: boolean;
}

export interface ReviewableOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  products: ReviewableProduct[];
}

export type OrderReviewAccess =
  | { ok: true; order: ReviewableOrder }
  | { ok: false; reason: "not_found" | "not_delivered" };

export async function findReviewableOrder(db: AppDb, input: { orderNumber: string; phone: string }): Promise<OrderReviewAccess> {
  const orderNumber = input.orderNumber.trim().toUpperCase();
  const [found] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      deliveredAt: shipments.deliveredAt,
    })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!found || !samePhone(found.phone, input.phone)) return { ok: false, reason: "not_found" };
  if (!found.deliveredAt) return { ok: false, reason: "not_delivered" };

  const lines = await db.all<{ productId: string; name: string; kept: number; imageSrc: string | null; reviewed: number }>(sql`
    select op.product_id as productId,
      min(op.product_name) as name,
      sum(op.quantity - op.returned_quantity) as kept,
      (select pi.src from product_images pi where pi.product_id = op.product_id order by pi.position limit 1) as imageSrc,
      exists (select 1 from reviews r where r.order_id = op.order_id and r.product_id = op.product_id) as reviewed
    from order_products op
    where op.order_id = ${found.id} and op.product_id is not null
    group by op.product_id
    order by min(op.created_at), op.product_id`);

  return {
    ok: true,
    order: {
      id: found.id,
      orderNumber: found.orderNumber,
      customerId: found.customerId,
      customerName: found.customerName,
      products: lines
        .filter((line) => Number(line.kept) > 0)
        .map((line) => ({ productId: line.productId, name: line.name, imageSrc: line.imageSrc ?? null, reviewed: Boolean(line.reviewed) })),
    },
  };
}
