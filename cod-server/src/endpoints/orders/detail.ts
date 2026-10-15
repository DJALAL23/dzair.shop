/**
 * An order as the API and the AI tools show it: the order, its delivery (the
 * shipment, with its history and actions) and where it stands overall.
 */

import type { AppDb } from "@/db";
import * as queries from "./queries";
import { loadShipmentView } from "../shipments/view";
import { getOrderShipment } from "../../../../cod-shared/shipments/queries";
import { orderNeedsAttention, orderStage } from "../../../../cod-shared/orders/stage";

export async function loadOrderDetail(db: AppDb, orderId: string) {
  const order = await queries.getOrderById(db, orderId);
  if (!order) return null;
  const shipment = (await getOrderShipment(db, orderId)) ?? null;
  return {
    ...order,
    shipment: shipment ? await loadShipmentView(db, shipment.id, { events: true }) : null,
    stage: orderStage(order.status, shipment),
    needsAttention: orderNeedsAttention(shipment),
  };
}
