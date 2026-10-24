import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n/core";
import { allowedTransitions } from "../../../../cod-shared/orders/lifecycle";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { SCOPE_FOR_KIND, scopeForShipmentAction } from "../../../../cod-shared/shipments/actions";
import { reportsAllowedFor, type MerchantReport } from "../../../../cod-shared/shipments/merchant-reports";
import type {
  AbandonedOrder,
  AbandonedOrderStatus,
  DeliveryCompany,
  DeliveryType,
  Driver,
  OrderBase,
  OrderListItem,
  OrderRemoval,
  OrderStage,
  OrderStageCounts,
  OrderStatus,
  Shipment,
  ShipmentAction,
  ShipmentEvent,
} from "./types";

/** Whether the person may act under a permission (the dashboard's `canScope` for the signed-in user). */
export type May = (scope: string) => boolean;

// ─── Work queues ─────────────────────────────────────────────────────────────

/**
 * The order list as the merchant's day goes: call to confirm, prepare, ship,
 * follow, then what was delivered, what came back, what was dropped. Every
 * stage sits in exactly one queue; a parcel the carrier cancelled waits to be
 * shipped again.
 */
export const ORDER_QUEUES = [
  { key: "to_confirm", stages: ["new", "unreachable"] },
  { key: "to_prepare", stages: ["confirmed", "preparing"] },
  { key: "to_ship", stages: ["ready_to_ship", "delivery_cancelled"] },
  { key: "on_the_way", stages: ["handoff_pending", "in_transit", "out_for_delivery"] },
  { key: "delivered", stages: ["delivered"] },
  { key: "returns", stages: ["returning", "returned"] },
  { key: "cancelled", stages: ["cancelled"] },
] as const satisfies ReadonlyArray<{ key: string; stages: readonly OrderStage[] }>;

export type QueueKey = (typeof ORDER_QUEUES)[number]["key"];
/** "all" shows every working order; "attention" those whose delivery needs the merchant; "archived" the finished ones put away. */
export type OrderView = QueueKey | "all" | "attention" | "archived";

export function queueOf(stage: OrderStage): QueueKey {
  return ORDER_QUEUES.find((queue) => (queue.stages as readonly OrderStage[]).includes(stage))!.key;
}

/** The server query a view stands for. */
export function viewQuery(view: OrderView): { stages?: readonly OrderStage[]; attention?: boolean; archived?: boolean } {
  if (view === "all") return {};
  if (view === "attention") return { attention: true };
  if (view === "archived") return { archived: true };
  return { stages: ORDER_QUEUES.find((queue) => queue.key === view)!.stages };
}

/** How many orders each view holds, from the counts by stage. */
export function viewCounts(counts: OrderStageCounts): Record<OrderView, number> {
  const byStage = new Map(counts.stages.map((entry) => [entry.stage, entry.count]));
  const total = ORDER_STAGES.reduce((sum, stage) => sum + (byStage.get(stage) ?? 0), 0);
  const queues = Object.fromEntries(
    ORDER_QUEUES.map((queue) => [queue.key, queue.stages.reduce((sum, stage) => sum + (byStage.get(stage) ?? 0), 0)]),
  ) as Record<QueueKey, number>;
  return { all: total, attention: counts.needsAttention, archived: counts.archived, ...queues };
}

// ─── What the stage looks like ───────────────────────────────────────────────

/** The dashboard's status palette, written out whole so the stylesheet keeps each class. */
const TONE = {
  new: "bg-[var(--status-new-bg)] text-[var(--status-new-text)] border-[var(--status-new-border)]",
  confirmed: "bg-[var(--status-confirmed-bg)] text-[var(--status-confirmed-text)] border-[var(--status-confirmed-border)]",
  preparing: "bg-[var(--status-preparing-bg)] text-[var(--status-preparing-text)] border-[var(--status-preparing-border)]",
  ready: "bg-[var(--status-ready-bg)] text-[var(--status-ready-text)] border-[var(--status-ready-border)]",
  assigned: "bg-[var(--status-assigned-bg)] text-[var(--status-assigned-text)] border-[var(--status-assigned-border)]",
  dispatched: "bg-[var(--status-dispatched-bg)] text-[var(--status-dispatched-text)] border-[var(--status-dispatched-border)]",
  out: "bg-[var(--status-out-bg)] text-[var(--status-out-text)] border-[var(--status-out-border)]",
  delivered: "bg-[var(--status-delivered-bg)] text-[var(--status-delivered-text)] border-[var(--status-delivered-border)]",
  returned: "bg-[var(--status-returned-bg)] text-[var(--status-returned-text)] border-[var(--status-returned-border)]",
  cancelled: "bg-[var(--status-cancelled-bg)] text-[var(--status-cancelled-text)] border-[var(--status-cancelled-border)]",
} as const;

/** Each stage's colour. */
export const STAGE_TONE: Record<OrderStage, keyof typeof TONE> = {
  new: "new",
  confirmed: "confirmed",
  unreachable: "preparing",
  preparing: "preparing",
  ready_to_ship: "ready",
  handoff_pending: "assigned",
  in_transit: "dispatched",
  out_for_delivery: "out",
  delivered: "delivered",
  returning: "returned",
  returned: "returned",
  delivery_cancelled: "cancelled",
  cancelled: "cancelled",
};

export function stageClass(stage: OrderStage): string {
  return TONE[STAGE_TONE[stage]];
}

/** Who carries the order, in a few words; null before its handoff. */
export function deliveredBy(order: Pick<OrderListItem, "shipmentKind" | "carrierName" | "driverName">): { kind: "carrier" | "driver"; name: string | null } | null {
  if (order.shipmentKind === "carrier") return { kind: "carrier", name: order.carrierName };
  if (order.shipmentKind === "driver") return { kind: "driver", name: order.driverName };
  return null;
}

// ─── The order's next step ───────────────────────────────────────────────────

export interface StatusMove {
  status: OrderStatus;
  emphasis: "primary" | "secondary" | "danger";
}

/** The move the merchant usually makes next, from each status. */
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  new: "confirmed",
  unreachable: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
};

/**
 * The status moves the lifecycle allows this order now, the usual next one
 * first and cancelling last. None once it has a shipment — its delivery is
 * the shipment's. Shipping a ready order is a handoff, not a status.
 */
export function statusMoves(order: Pick<OrderBase, "status"> & { hasShipment: boolean }): StatusMove[] {
  const allowed = allowedTransitions({ status: order.status, hasShipment: order.hasShipment });
  const next = NEXT[order.status];
  const moves: StatusMove[] = allowed
    .filter((status) => status !== "cancelled")
    .map((status) => ({ status, emphasis: status === next ? "primary" : "secondary" }));
  moves.sort((left, right) => (left.emphasis === "primary" ? -1 : right.emphasis === "primary" ? 1 : 0));
  if (allowed.includes("cancelled")) moves.push({ status: "cancelled", emphasis: "danger" });
  return moves;
}

/** A ready order with no shipment waits to be handed to a carrier or a driver. */
export function canHandOff(order: Pick<OrderBase, "status"> & { hasShipment: boolean }): boolean {
  return order.status === "ready" && !order.hasShipment;
}

/** Whether this person may hand orders to a carrier, to the store's driver, or both. */
export function handoffKinds(may: May): Array<"carrier" | "driver"> {
  return (["carrier", "driver"] as const).filter((kind) => may(SCOPE_FOR_KIND[kind]));
}

/** The customer's details change on the order only before its handoff; after it, through the parcel. */
export function canEditOrder(order: Pick<OrderBase, "status"> & { hasShipment: boolean }): boolean {
  return !order.hasShipment && order.status !== "cancelled";
}

/** What deleting an order takes away and what stays, in the merchant's words — from the server's own reading. */
export function orderDeletionConsequences(removal: OrderRemoval, t: Translate): Array<{ text: string; kept?: boolean }> {
  return [
    { text: t("removal.lines", { count: removal.lines }) },
    ...(removal.restockUnits > 0 ? [{ text: t("removal.restock", { count: removal.restockUnits }), kept: true }] : []),
    ...(removal.reviews > 0 ? [{ text: t("removal.reviews", { count: removal.reviews }) }] : []),
    { text: t("removal.customer_kept"), kept: true },
  ];
}

/**
 * Units a customer kept back at the door are recorded on a delivered order:
 * they come back to stock. A returned or cancelled order already put every
 * unit back.
 */
export function canRecordRefusedUnits(stage: OrderStage): boolean {
  return stage === "delivered";
}

// ─── Handing off ─────────────────────────────────────────────────────────────

/** The carriers that can take this parcel now: active, connected, and serving the delivery type. */
export function carriersFor(companies: DeliveryCompany[], deliveryType: DeliveryType): DeliveryCompany[] {
  return companies.filter((company) => {
    const caps = company.capabilities;
    if (!company.active || !company.isConnected || !company.provider || !caps) return false;
    return deliveryType === "home" ? caps.homeDelivery && company.supportsHomeDelivery : caps.stopDesk && company.supportsStopDesk;
  });
}

/** The carriers that can take every one of several parcels, each travelling as its customer asked. */
export function carriersForAll(companies: DeliveryCompany[], deliveryTypes: Iterable<DeliveryType>): DeliveryCompany[] {
  const wanted = [...new Set(deliveryTypes)];
  return companies.filter((company) => wanted.every((type) => carriersFor([company], type).length > 0));
}

/** The store's drivers who take orders. */
export function driversFor(drivers: Driver[]): Driver[] {
  return drivers.filter((driver) => driver.status !== "inactive");
}

/**
 * What giving these orders to the store's driver does. The driver delivers to
 * the customer's door, never to a stop desk: an order with no street address
 * cannot be given, and one whose customer chose a stop desk is brought to
 * their address instead, for the same amount.
 */
export function driverHandoffPlan<T extends Pick<OrderBase, "address" | "deliveryType">>(orders: readonly T[]) {
  const deliverable = orders.filter((order) => Boolean(order.address?.trim()));
  return {
    deliverable,
    missingAddress: orders.filter((order) => !order.address?.trim()),
    deskToDoor: deliverable.filter((order) => order.deliveryType === "stop_desk"),
  };
}

/** How many orders one bulk handoff takes (the server's limit). */
export const BULK_HANDOFF_LIMIT = 100;

/** How much of what can be shipped is selected; "all" once a bulk handoff is full. */
export function bulkSelection(selected: ReadonlySet<string>, selectable: readonly string[]): "none" | "some" | "all" {
  const count = selectable.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === selectable.length || count >= BULK_HANDOFF_LIMIT ? "all" : "some";
}

// ─── Acting on a shipment ────────────────────────────────────────────────────

/** What this person may do to the shipment now: what the server says is open, that their permissions allow. */
export function offeredActions(shipment: Pick<Shipment, "kind" | "actions">, may: May): ShipmentAction[] {
  return shipment.actions.filter((action) => may(scopeForShipmentAction(action, shipment.kind)));
}

/** What the merchant may report on this shipment: a driver's progress, or that a carrier's goods came back. */
export function reportsFor(shipment: Pick<Shipment, "kind">): readonly MerchantReport[] {
  return reportsAllowedFor(shipment.kind);
}

/** The steps CodFlow itself records, the driver's progress, and the delivery words of orders from before shipments. */
const OUR_WORDS = new Set([
  "created",
  "created_and_validated",
  "validated",
  "validation_failed",
  "handoff_outcome_unknown",
  "parcel_updated",
  "remark_added",
  "return_requested",
  "new_attempt_requested",
  "assigned_to_driver",
  "out_for_delivery",
  "failed_attempt",
  "delivered",
  "returned",
  "assigned",
  "dispatched",
]);
const OUR_VOCABULARIES = new Set(["codflow", "driver", "merchant", "legacy"]);

/**
 * How a history entry reads: CodFlow's own steps and the driver's progress
 * in the merchant's language (`event.<value>`); a carrier's status as the
 * carrier writes it, the way the merchant knows it from the carrier's app.
 */
export function eventLabel(event: Pick<ShipmentEvent, "vocabulary" | "providerStatus" | "providerStatusLabel">): { key: string } | { text: string } {
  const value = event.providerStatus ?? "";
  if (OUR_VOCABULARIES.has(event.vocabulary ?? "") && OUR_WORDS.has(value)) return { key: `event.${value}` };
  return { text: event.providerStatusLabel ?? (value || "-") };
}

/** The shipment's latest status, read like its history entry. */
export function latestStatusLabel(shipment: Pick<Shipment, "providerStatus" | "providerStatusLabel" | "events">): { key: string } | { text: string } | null {
  if (!shipment.providerStatus) return null;
  const entry = deliveryTimeline(shipment).find((event) => event.providerStatus === shipment.providerStatus);
  return entry ? eventLabel(entry) : { text: shipment.providerStatusLabel ?? shipment.providerStatus };
}

export type AttentionReason =
  | { kind: "unknown_handoff" }
  | { kind: "cancelled_by_carrier" }
  | { kind: "flagged"; detail: string | null };

/** Why the delivery needs the merchant, in the order they must act on it; null when it does not. */
export function attentionReason(shipment: Pick<Shipment, "handoffState" | "cancelledAt" | "attentionSince" | "events">): AttentionReason | null {
  if (shipment.handoffState === "unknown") return { kind: "unknown_handoff" };
  if (shipment.cancelledAt) return { kind: "cancelled_by_carrier" };
  if (!shipment.attentionSince) return null;
  const flag = deliveryTimeline(shipment).find((event) => event.attention);
  return { kind: "flagged", detail: flag ? (flag.reason ?? flag.providerStatusLabel ?? flag.providerStatus) : null };
}

/** The shipment's history, newest first. */
export function deliveryTimeline(shipment: Pick<Shipment, "events">): ShipmentEvent[] {
  return [...(shipment.events ?? [])].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.recordedAt.localeCompare(left.recordedAt));
}

export function formatMoney(
  amount: number | null | undefined,
  locale: Locale,
  currency = "DA",
): string {
  if (amount == null) return "-";
  return `${new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(amount)} ${currency}`;
}

export function orderTotal(
  order: Pick<OrderListItem, "price" | "deliveryFee">,
): number {
  return order.price + order.deliveryFee;
}

const ABANDONED_TRANSITIONS: Record<
  AbandonedOrderStatus,
  AbandonedOrderStatus[]
> = {
  pending: ["contacted", "abandoned"],
  abandoned: ["contacted", "converted"],
  contacted: ["converted", "abandoned"],
  converted: [],
};

export function abandonedStatusOptions(
  status: AbandonedOrderStatus,
): AbandonedOrderStatus[] {
  return [status, ...ABANDONED_TRANSITIONS[status]];
}

/** One row of the basket, ready to render. */
export interface AbandonedBasketLine {
  key: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
}

/**
 * What to show in the "what they were buying" column.
 *
 * Three genuinely different cases, kept apart on purpose rather than flattened
 * into one list:
 *
 *   basket   the shopper abandoned a cart, and every line is known — quantity
 *            included. The list shows all of them, because this column exists
 *            so a merchant can ring the customer and say what they had.
 *   product  a single-product checkout. The record never stored a quantity,
 *            so rendering "1×" here would be inventing one: the shopper may
 *            well have been ordering three.
 *   unknown  contact details captured before the shopper picked anything.
 */
export type AbandonedBasketView =
  | { kind: "basket"; lines: AbandonedBasketLine[] }
  | { kind: "product"; productName: string; variantLabel: string | null }
  | { kind: "unknown" };

export function abandonedBasketView(
  row: Pick<AbandonedOrder, "items" | "productName" | "variantLabel">,
): AbandonedBasketView {
  if (row.items && row.items.length > 0) {
    return {
      kind: "basket",
      lines: row.items.map((item, index) => ({
        key: `${item.productId}-${item.variantId ?? ""}-${index}`,
        productName: item.productName,
        variantLabel: item.variantLabel ?? null,
        quantity: item.quantity,
      })),
    };
  }

  if (!row.productName) return { kind: "unknown" };

  return {
    kind: "product",
    productName: row.productName,
    variantLabel: row.variantLabel ?? null,
  };
}

export interface AbandonedFilters {
  query: string;
  status: string;
}

export function filterAbandonedOrders(
  rows: AbandonedOrder[],
  filters: AbandonedFilters,
): AbandonedOrder[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      query &&
      !`${row.customerName} ${row.phone} ${row.productName ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (filters.status !== "all" && row.status !== filters.status)
      return false;
    return true;
  });
}

/** Why units refused at the door could not be recorded, in the merchant's words. */
export function lineReturnError(cause: unknown, t: Translate): string {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === "ORDER_NOT_DELIVERED") return t("refused.error_not_delivered");
  if (code === "INVALID_STATUS_TRANSITION") return t("refused.error_closed");
  if (code === "ORDER_CHANGED") return t("refused.error_changed");
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why clearing an order away was refused, in the merchant's words. */
export function orderRemovalError(cause: unknown, t: Translate): string {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === "ORDER_HAS_SHIPMENT") return t("removal.error_has_shipment");
  if (code === "ORDER_NOT_FINISHED") return t("removal.error_not_finished");
  if (code === "ORDER_CHANGED") return t("removal.error_changed");
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What the shopper's items cost before the coupon — the order's price is net
 * of it, its lines carrying their share — so the merchant reads the items at
 * the price they were offered, the coupon as its own row.
 */
export function subtotalBeforeCoupon(order: { price: number; couponDiscount?: number | null }): number {
  return order.price + (order.couponDiscount ?? 0);
}

/**
 * The receipt's delivery row: the fee, or free — and when an offer made it
 * free, that it did. A free-delivery code says so on its own row.
 */
export function deliveryLabel(order: { deliveryFee: number; deliveryOfferId: string | null; deliveryOfferName: string | null }, t: Translate, locale: Locale): string {
  if (order.deliveryFee > 0) return formatMoney(order.deliveryFee, locale);
  if (order.deliveryOfferName) return t("detail.delivery_free_named", { name: order.deliveryOfferName });
  return order.deliveryOfferId ? t("detail.delivery_free_offer") : t("form.free");
}

/**
 * What an order line says of its offer: the gift it is, or the offer that
 * priced it — by the name the offer had when the order was placed. Null for a
 * line no offer touched.
 */
export function offerLineLabel(line: { reward: boolean; offerId: string | null; offerName: string | null }, t: Translate): string | null {
  if (line.reward) return line.offerName ? t("detail.line_reward_named", { name: line.offerName }) : t("detail.line_reward");
  if (line.offerName) return t("detail.line_offer_named", { name: line.offerName });
  return line.offerId ? t("detail.line_offer") : null;
}

/** A line's unit price and total before its share of the coupon. */
export function lineBeforeCoupon(line: { lineTotal: number; quantity: number; discount?: number | null }): { unit: number; total: number } {
  const total = line.lineTotal + (line.discount ?? 0);
  return { unit: line.quantity > 0 ? total / line.quantity : 0, total };
}
