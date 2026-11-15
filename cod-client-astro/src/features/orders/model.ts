import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n/core";
import { allowedTransitions } from "../../../../cod-shared/orders/lifecycle";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { SCOPE_FOR_KIND, scopeForShipmentAction } from "../../../../cod-shared/shipments/actions";
import { reportsAllowedFor, type MerchantReport } from "../../../../cod-shared/shipments/merchant-reports";
import type { OrderAttributionView } from "../../../../cod-shared/attribution/view";
import { PAID_CHANNELS, type OrderChannel } from "../../../../cod-shared/attribution/model";
import { androidAppName } from "../../../../cod-shared/attribution/channel";
import type { CallList } from "../../../../cod-shared/orders/calls";
import type {
  AbandonedOrder,
  AbandonedOrderStatus,
  DeliveryCompany,
  DeliveryType,
  Driver,
  OrderBase,
  OrderListItem,
  OrderProduct,
  OrderRemoval,
  OrderStage,
  OrderStageCounts,
  OrderStatus,
  Shipment,
  ShipmentAction,
  ShipmentEvent,
  StatusHistoryItem,
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
/**
 * "all" shows every working order; "attention" those whose delivery needs
 * the merchant; "callbacks" the customers to call back, soonest first;
 * "archived" the finished ones put away.
 */
export type OrderView = QueueKey | "all" | "attention" | "callbacks" | "archived";

/** The server query a view stands for. */
export function viewQuery(view: OrderView): { stages?: readonly OrderStage[]; attention?: boolean; callbacks?: boolean; archived?: boolean } {
  if (view === "all") return {};
  if (view === "attention") return { attention: true };
  if (view === "callbacks") return { callbacks: true };
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
  return { all: total, attention: counts.needsAttention, callbacks: counts.callbacks, archived: counts.archived, ...queues };
}

// ─── Calls without an answer ─────────────────────────────────────────────────

/**
 * The orders to confirm, step by step as a confirmation team works them: the
 * new ones, then those on no answer after one call, two, three or more.
 */
export const CONFIRM_STEPS = ["new", "call1", "call2", "call3"] as const;
export type ConfirmStep = (typeof CONFIRM_STEPS)[number];

const STEP_CALLS: Record<Exclude<ConfirmStep, "new">, CallList> = { call1: 1, call2: 2, call3: 3 };

/** The server query a step adds to the "To confirm" queue's. */
export function confirmStepQuery(step: ConfirmStep): { stages?: readonly OrderStage[]; calls?: CallList } {
  return step === "new" ? { stages: ["new"] } : { calls: STEP_CALLS[step] };
}

/** How many orders each step holds. */
export function confirmStepCounts(counts: OrderStageCounts): Record<ConfirmStep, number> {
  return {
    new: counts.stages.find((entry) => entry.stage === "new")?.count ?? 0,
    call1: counts.noAnswer.call1,
    call2: counts.noAnswer.call2,
    call3: counts.noAnswer.call3OrMore,
  };
}

/** The step a URL opens, only within the "To confirm" queue. */
export function confirmStepFrom(search: string, view: OrderView): ConfirmStep | null {
  const step = new URLSearchParams(search).get("step");
  return view === "to_confirm" && (CONFIRM_STEPS as readonly string[]).includes(step ?? "") ? (step as ConfirmStep) : null;
}

/**
 * Which call each "No answer" in an order's timeline was, counted back from
 * the order's own count: the newest is its last call. The Event Log is
 * pruned, so counting forward from the oldest step left would misnumber.
 */
export function callNumbers(history: readonly StatusHistoryItem[], unansweredCalls: number): Map<string, number> {
  const calls = history
    .filter((step) => step.status === "unreachable")
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id));
  return new Map(calls.flatMap((step, index) => (unansweredCalls - index > 0 ? [[step.id, unansweredCalls - index] as const] : [])));
}

/** A stage in words: on no answer, which call the order is at. */
export function stageLabel(t: Translate, stage: OrderStage, unansweredCalls: number): string {
  return stage === "unreachable" && unansweredCalls > 0 ? t("calls.no_answer", { call: unansweredCalls }) : t(`stage.${stage}`);
}

/** A status move in words: "No answer" says which call it records. */
export function moveLabel(t: Translate, status: OrderStatus, unansweredCalls: number): string {
  return status === "unreachable" ? t("calls.no_answer", { call: unansweredCalls + 1 }) : t(`move.${status}`);
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

export type StatusContext =
  | { kind: "callback"; at: string }
  | { kind: "carrier" | "driver"; name: string | null }
  | { kind: "no_answer_cancel"; calls: number };

/**
 * The one fact an order's status card adds under its stage: when to call a
 * waiting customer back, who carries a shipped order, or how many calls went
 * unanswered before an order that was never confirmed was cancelled.
 */
export function statusContext(
  order: Pick<OrderListItem, "status" | "stage" | "callbackAt" | "shipmentKind" | "carrierName" | "driverName" | "unansweredCalls" | "confirmedAt">,
): StatusContext | null {
  if (order.callbackAt && (order.status === "new" || order.status === "unreachable")) return { kind: "callback", at: order.callbackAt };
  const by = deliveredBy(order);
  if (by) return by;
  if (order.stage === "cancelled" && order.unansweredCalls > 0 && !order.confirmedAt) return { kind: "no_answer_cancel", calls: order.unansweredCalls };
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

export interface NextStepLayout {
  /** A waiting order's two results of a call, side by side: confirmed, and no answer. */
  outcomes: StatusMove[];
  /** Every other move, the usual next one first. */
  others: StatusMove[];
  /** Moves kept out of the way: a call without an answer on an order already confirmed. */
  more: StatusMove[];
  cancel: StatusMove | null;
}

/**
 * How the next step lays out an order's moves. A call has two results, so a
 * waiting order shows them side by side; once confirmed, preparing comes
 * next, and another call without an answer stays behind More. Cancelling
 * always stands apart.
 */
export function nextStepLayout(status: OrderStatus, moves: StatusMove[]): NextStepLayout {
  const cancel = moves.find((move) => move.status === "cancelled") ?? null;
  const rest = moves.filter((move) => move.status !== "cancelled");
  if (status === "new" || status === "unreachable") return { outcomes: rest, others: [], more: [], cancel };
  return { outcomes: [], others: rest.filter((move) => move.status !== "unreachable"), more: rest.filter((move) => move.status === "unreachable"), cancel };
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

/**
 * What became of a line's units that went back to stock: kept back at the
 * door on a delivered order; put back when the order was cancelled or its
 * parcel came back.
 */
export function lineReturnNote(stage: OrderStage, line: Pick<OrderProduct, "returnedQuantity">, t: Translate): { text: string; refused: boolean } | null {
  if (line.returnedQuantity <= 0) return null;
  const refused = canRecordRefusedUnits(stage);
  return { text: t(refused ? "refused.count" : "refused.restocked", { count: line.returnedQuantity }), refused };
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

/**
 * What the fee box of an order being entered says beneath it: the store's
 * fee there and why it is free — or that the store does not deliver there —
 * and, once the merchant typed a fee of their own, what the store's is.
 */
export function deliveryFeeHint(
  quote: import("./api").DeliveryQuote | null,
  typed: boolean,
  locale: Locale,
): { key: string; values?: Record<string, string> } | null {
  if (!quote) return null;
  if (!quote.available) return { key: typed ? "form.fee_hint_typed_unserved" : "form.fee_hint_unserved" };
  if (typed) return quote.free ? { key: "form.fee_hint_typed_free" } : { key: "form.fee_hint_typed", values: { fee: formatMoney(quote.fee, locale) } };
  if (quote.free?.by === "threshold") return { key: "form.fee_hint_free_threshold", values: { amount: formatMoney(quote.free.threshold, locale) } };
  if (quote.free?.by === "offer") return quote.free.offerName ? { key: "form.fee_hint_free_offer_named", values: { name: quote.free.offerName } } : { key: "form.fee_hint_free_offer" };
  return { key: "form.fee_hint_rate" };
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

/** What an order's source says first: the i18n key of its headline under `source.headline`, and the network it names. Null when it is not known. */
export function sourceHeadline(source: { channel: OrderChannel | null; platform: string | null; app: string | null } | null | undefined): { key: string; network: string | null } | null {
  if (!source?.channel) return null;
  const { channel } = source;
  if ((PAID_CHANNELS as readonly string[]).includes(channel)) return { key: "paid", network: networkOf(source.platform, source.app) };
  if (channel === "organic_social" || channel === "organic_search") return { key: channel, network: networkOf(source.platform, source.app) };
  return { key: channel, network: null };
}

/** The network a source names, as a key under `source.network`: the Meta app when known. */
export function networkOf(platform: string | null, app: string | null): string {
  if (platform === "meta") return app ?? "meta";
  return platform === "tiktok" || platform === "google" || platform === "bing" || platform === "snapchat" ? platform : "other";
}

const META_PLACEMENT_APPS = ["Facebook", "Instagram", "Messenger", "Threads", "WhatsApp"];

/** Meta's placement as a person reads it: `Facebook_Mobile_Feed` is "Facebook · Mobile Feed". */
export function readablePlacement(placement: string): string {
  const words = placement.split(/[_\s]+/).filter(Boolean);
  if (words[0] === "Audience" && words[1] === "Network") return ["Audience Network", words.slice(2).join(" ")].filter(Boolean).join(" · ");
  if (words[0] && META_PLACEMENT_APPS.includes(words[0]) && words.length > 1) return `${words[0]} · ${words.slice(1).join(" ")}`;
  return words.join(" ");
}

/** How long before the order the shopper clicked: the i18n key under `source` and its count. */
export function beforeOrder(clickedAt: string, orderedAt: string): { key: string; count?: number } {
  const ms = Date.parse(orderedAt) - Date.parse(clickedAt);
  if (!Number.isFinite(ms) || ms < 60_000) return { key: "just_before" };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { key: "minutes_before", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { key: "hours_before", count: hours };
  return { key: "days_before", count: Math.floor(hours / 24) };
}

export type SourceFactKey = "campaign" | "ad" | "placement" | "landing" | "referrer" | "clicked_at" | "arrived_at";
export type SourceFact = { key: SourceFactKey; value: string };

/** How the source card words what only translations know: an Android app's name, a storefront page. */
export interface SourceLabels {
  app: (app: string) => string;
  page: (page: StorePage) => string;
}

/** The storefront page types whose path names one thing (a product, a landing page…). */
const NAMED_PAGES = new Set(["category", "collection", "product", "page", "landing"]);

/** A storefront page a visit landed on: its type and, for a page about one thing, its slug. */
export interface StorePage {
  type: string;
  name: string | null;
}

/** The page a landing path is, as the source card names it: "Product · robe-qa", "Home page"; a path no page type has is kept as it is. */
export function storePage(path: string | null, type: string | null): StorePage | null {
  if (!path) return null;
  if (!type) return { type: "other", name: path };
  const slug = path.split("/").filter(Boolean).at(-1) ?? null;
  if (!NAMED_PAGES.has(type) || !slug) return { type, name: null };
  try {
    return { type, name: decodeURIComponent(slug) };
  } catch {
    return { type, name: slug };
  }
}

const pageValue = (path: string | null, type: string | null, labels: SourceLabels) => {
  const page = storePage(path, type);
  return page ? labels.page(page) : null;
};

const when = (at: string, locale: Locale) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
const kept = (facts: Array<{ key: SourceFactKey; value: string | null | undefined }>) => facts.filter((fact): fact is SourceFact => Boolean(fact.value));

/** What the credited ad says, in reading order; only the facts it has. Names before ids. */
export function adFacts(ad: NonNullable<OrderAttributionView["ad"]>, locale: Locale, labels: SourceLabels): SourceFact[] {
  return kept([
    { key: "campaign", value: ad.campaignName ?? ad.campaignId ?? ad.utmCampaign },
    { key: "ad", value: ad.adName ?? ad.adId },
    { key: "placement", value: ad.placement ? readablePlacement(ad.placement) : null },
    { key: "landing", value: pageValue(ad.landingPath, ad.landingPageType, labels) },
    { key: "clicked_at", value: ad.clickedAt ? when(ad.clickedAt, locale) : null },
  ]);
}

/** Where a visit came from as a person reads it: the Android app by its name ("Google app on Android"), else the site. */
export function referrerLabel(host: string | null, appLabel: (app: string) => string): string | null {
  const app = androidAppName(host);
  return app ? appLabel(app) : host;
}

/** What a visit says (this one, the earlier one the source comes from, or the first), in reading order; only the facts it has. */
export function visitFacts(visit: NonNullable<OrderAttributionView["visit"]>, locale: Locale, labels: SourceLabels): SourceFact[] {
  return kept([
    { key: "referrer", value: referrerLabel(visit.referrerHost, labels.app) },
    { key: "campaign", value: visit.utmCampaign },
    { key: "landing", value: pageValue(visit.landingPath, visit.landingPageType, labels) },
    { key: "arrived_at", value: visit.at ? when(visit.at, locale) : null },
  ]);
}

/** One visit on an order's journey: the first visit, the credited ad or earlier visit, or the visit the shopper ordered in. */
export interface JourneyStep {
  kind: "first" | "ad" | "earlier" | "visit";
  at: string | null;
  source: { channel: OrderChannel; platform: string | null; app: string | null };
  /** The order's source. */
  credited: boolean;
  /** The visit the shopper ordered in. */
  ordered: boolean;
}

/**
 * The visits that led to an order, oldest first: the first visit when it is
 * not another step, the credited ad or earlier visit, then the visit the
 * shopper ordered in. One visit is one step: an ad clicked in the visit that
 * ordered is a single credited, ordered step. Empty when no visit is known.
 */
export function sourceJourney(view: Pick<OrderAttributionView, "channel" | "platform" | "app" | "ad" | "visit" | "earlier" | "first">): JourneyStep[] {
  const { channel, ad, earlier, visit, first } = view;
  if (!channel) return [];
  const steps: JourneyStep[] = [];
  if (ad || earlier) {
    const at = ad ? ad.clickedAt : earlier!.at;
    steps.push({ kind: ad ? "ad" : "earlier", at, source: { channel, platform: view.platform, app: view.app }, credited: true, ordered: visit !== null && visit.at === at });
  }
  if (visit && !steps[0]?.ordered) {
    steps.push({ kind: "visit", at: visit.at, source: { channel: visit.channel, platform: visit.platform, app: visit.app }, credited: steps.length === 0, ordered: true });
  }
  if (first?.at && steps.length > 0 && !steps.some((step) => step.at === first.at)) {
    steps.unshift({ kind: "first", at: first.at, source: { channel: first.channel, platform: first.platform, app: first.app }, credited: false, ordered: false });
  }
  return steps;
}

/** The source filter of the orders list: each choice and the channels it shows. */
export const SOURCE_FILTERS = {
  ads: ["paid_social", "paid_search", "paid_other"],
  social: ["organic_social"],
  search: ["organic_search"],
  ai: ["ai_assistant"],
  direct: ["direct"],
  other: ["referral", "tagged", "email"],
  team: ["dashboard", "api", "agent"],
  unknown: ["unknown"],
} as const satisfies Record<string, readonly (OrderChannel | "unknown")[]>;

export type SourceFilter = keyof typeof SOURCE_FILTERS;
