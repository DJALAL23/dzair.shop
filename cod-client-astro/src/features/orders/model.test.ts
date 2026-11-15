import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { SHIPMENT_ACTIONS } from "../../../../cod-shared/shipments/actions";
import type { OrderAttributionView } from "../../../../cod-shared/attribution/view";
import { ORDER_CHANNELS, type AttributionPlatform } from "../../../../cod-shared/attribution/model";
import {
  adFacts,
  beforeOrder,
  readablePlacement,
  SOURCE_FILTERS,
  sourceHeadline,
  sourceJourney,
  storePage,
  visitFacts,
  type SourceLabels,
  type StorePage,
  abandonedBasketView,
  attentionReason,
  eventLabel,
  canEditOrder,
  orderDeletionConsequences,
  orderRemovalError,
  canHandOff,
  canRecordRefusedUnits,
  carriersFor,
  carriersForAll,
  deliveredBy,
  statusContext,
  deliveryFeeHint,
  deliveryTimeline,
  driversFor,
  driverHandoffPlan,
  BULK_HANDOFF_LIMIT,
  bulkSelection,
  formatMoney,
  latestStatusLabel,
  lineReturnError,
  lineReturnNote,
  handoffKinds,
  offeredActions,
  ORDER_QUEUES,
  orderTotal,
  lineBeforeCoupon,
  deliveryLabel,
  offerLineLabel,
  subtotalBeforeCoupon,
  reportsFor,
  statusMoves,
  nextStepLayout,
  viewCounts,
  viewQuery,
  type May,
} from "./model";
import type { CarrierCapabilities, DeliveryCompany, Driver, ShipmentEvent } from "./types";

const scopes = (...granted: string[]): May => (scope) => granted.includes(scope);

describe("the delivery fee of an order being entered", () => {
  const rate = { available: true as const, rate: 400, fee: 400, free: null };
  it("says the store's fee and why it is free", () => {
    expect(deliveryFeeHint(null, false, "en")).toBeNull();
    expect(deliveryFeeHint(rate, false, "en")).toEqual({ key: "form.fee_hint_rate" });
    expect(deliveryFeeHint({ available: true, rate: 400, fee: 0, free: { by: "threshold", threshold: 10000 } }, false, "en")?.key).toBe("form.fee_hint_free_threshold");
    expect(deliveryFeeHint({ available: true, rate: 400, fee: 0, free: { by: "offer", offerId: "o", offerName: "Ship free" } }, false, "en")).toEqual({ key: "form.fee_hint_free_offer_named", values: { name: "Ship free" } });
    expect(deliveryFeeHint({ available: true, rate: 400, fee: 0, free: { by: "offer", offerId: "o", offerName: null } }, false, "en")).toEqual({ key: "form.fee_hint_free_offer" });
  });

  it("says when the store does not deliver there, and what the store's fee is beside a typed one", () => {
    expect(deliveryFeeHint({ available: false }, false, "en")).toEqual({ key: "form.fee_hint_unserved" });
    expect(deliveryFeeHint({ available: false }, true, "en")).toEqual({ key: "form.fee_hint_typed_unserved" });
    expect(deliveryFeeHint(rate, true, "en")?.key).toBe("form.fee_hint_typed");
    expect(deliveryFeeHint({ available: true, rate: 400, fee: 0, free: { by: "offer", offerId: "o", offerName: "Ship free" } }, true, "en")).toEqual({ key: "form.fee_hint_typed_free" });
  });
});

describe("units refused at the door", () => {
  it("are explained by why the server refused them", () => {
    const t = (key: string) => key;
    const refused = (code: string) => Object.assign(new Error("server words"), { code });
    expect(lineReturnError(refused("ORDER_NOT_DELIVERED"), t)).toBe("refused.error_not_delivered");
    expect(lineReturnError(refused("INVALID_STATUS_TRANSITION"), t)).toBe("refused.error_closed");
    expect(lineReturnError(refused("ORDER_CHANGED"), t)).toBe("refused.error_changed");
    expect(lineReturnError(refused("SOMETHING_ELSE"), t)).toBe("server words");
  });
});

describe("the order list's work queues", () => {
  it("puts every stage in exactly one queue", () => {
    const placed = ORDER_QUEUES.flatMap((queue) => queue.stages);
    expect([...placed].sort()).toEqual([...ORDER_STAGES].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("asks the server for a queue's stages, or for what needs attention", () => {
    expect(viewQuery("all")).toEqual({});
    expect(viewQuery("attention")).toEqual({ attention: true });
    expect(viewQuery("archived")).toEqual({ archived: true });
    expect(viewQuery("callbacks")).toEqual({ callbacks: true });
    expect(viewQuery("on_the_way")).toEqual({ stages: ["handoff_pending", "in_transit", "out_for_delivery"] });
  });

  it("counts each queue from the counts by stage", () => {
    const counts = viewCounts({
      stages: [
        { stage: "new", count: 3 },
        { stage: "unreachable", count: 2 },
        { stage: "in_transit", count: 4 },
        { stage: "out_for_delivery", count: 1 },
        { stage: "delivery_cancelled", count: 1 },
      ],
      needsAttention: 2,
      archived: 0,
      callbacks: 3,
      callbacksDue: 1,
      noAnswer: { call1: 1, call2: 1, call3OrMore: 0 },
      deliveryRate: null,
    });
    expect(counts).toEqual({ all: 11, attention: 2, callbacks: 3, archived: 0, to_confirm: 5, to_prepare: 0, to_ship: 1, on_the_way: 5, delivered: 0, returns: 0, cancelled: 0 });
  });
});

describe("an order's next step", () => {
  it("offers the usual next move first and cancelling last, as the lifecycle allows", () => {
    expect(statusMoves({ status: "new", hasShipment: false })).toEqual([
      { status: "confirmed", emphasis: "primary" },
      { status: "unreachable", emphasis: "secondary" },
      { status: "cancelled", emphasis: "danger" },
    ]);
    expect(statusMoves({ status: "confirmed", hasShipment: false }).map((move) => move.status)).toEqual(["preparing", "ready", "unreachable", "cancelled"]);
    expect(statusMoves({ status: "ready", hasShipment: false })).toEqual([{ status: "cancelled", emphasis: "danger" }]);
    expect(statusMoves({ status: "cancelled", hasShipment: false })).toEqual([]);
  });

  it("lays a waiting order's two results of a call side by side, confirming first, and cancelling apart", () => {
    for (const status of ["new", "unreachable"] as const) {
      expect(nextStepLayout(status, statusMoves({ status, hasShipment: false }))).toEqual({
        outcomes: [
          { status: "confirmed", emphasis: "primary" },
          { status: "unreachable", emphasis: "secondary" },
        ],
        others: [],
        more: [],
        cancel: { status: "cancelled", emphasis: "danger" },
      });
    }
  });

  it("keeps a call without an answer on a confirmed order out of the way, behind More", () => {
    expect(nextStepLayout("confirmed", statusMoves({ status: "confirmed", hasShipment: false }))).toEqual({
      outcomes: [],
      others: [
        { status: "preparing", emphasis: "primary" },
        { status: "ready", emphasis: "secondary" },
      ],
      more: [{ status: "unreachable", emphasis: "secondary" }],
      cancel: { status: "cancelled", emphasis: "danger" },
    });
  });

  it("offers a later order its next move and cancelling, and nothing at all once it is decided", () => {
    expect(nextStepLayout("preparing", statusMoves({ status: "preparing", hasShipment: false }))).toEqual({
      outcomes: [],
      others: [{ status: "ready", emphasis: "primary" }],
      more: [],
      cancel: { status: "cancelled", emphasis: "danger" },
    });
    expect(nextStepLayout("ready", statusMoves({ status: "ready", hasShipment: true }))).toEqual({ outcomes: [], others: [], more: [], cancel: null });
  });

  it("offers no status move once the order has a shipment — its delivery is the shipment's", () => {
    expect(statusMoves({ status: "ready", hasShipment: true })).toEqual([]);
  });

  it("ships only a ready order with no shipment", () => {
    expect(canHandOff({ status: "ready", hasShipment: false })).toBe(true);
    expect(canHandOff({ status: "ready", hasShipment: true })).toBe(false);
    expect(canHandOff({ status: "preparing", hasShipment: false })).toBe(false);
  });

  it("edits the customer's details on the order only before its handoff", () => {
    expect(canEditOrder({ status: "confirmed", hasShipment: false })).toBe(true);
    expect(canEditOrder({ status: "ready", hasShipment: true })).toBe(false);
    expect(canEditOrder({ status: "cancelled", hasShipment: false })).toBe(false);
  });

  it("records units refused at the door only on a delivered order", () => {
    expect(ORDER_STAGES.filter(canRecordRefusedUnits)).toEqual(["delivered"]);
  });

  it("calls units that went back to stock refused at the door only on a delivered order", () => {
    const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.count}`;
    expect(lineReturnNote("delivered", { returnedQuantity: 1 }, t)).toEqual({ text: "refused.count:1", refused: true });
    for (const stage of ORDER_STAGES.filter((stage) => stage !== "delivered")) {
      expect(lineReturnNote(stage, { returnedQuantity: 2 }, t)).toEqual({ text: "refused.restocked:2", refused: false });
    }
    for (const stage of ORDER_STAGES) expect(lineReturnNote(stage, { returnedQuantity: 0 }, t)).toBeNull();
  });

  it("says what deleting an order takes away and what stays, from the server's reading", () => {
    const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${values.count}` : key);
    const removal = { id: "o", orderNumber: "ORD-1", shipment: "none" as const, deletable: true, archivable: false, archivedAt: null, lines: 2, restockUnits: 3, reviews: 0 };
    expect(orderDeletionConsequences(removal, t)).toEqual([
      { text: "removal.lines:2" },
      { text: "removal.restock:3", kept: true },
      { text: "removal.customer_kept", kept: true },
    ]);
    expect(orderDeletionConsequences({ ...removal, restockUnits: 0, reviews: 1 }, t)).toEqual([
      { text: "removal.lines:2" },
      { text: "removal.reviews:1" },
      { text: "removal.customer_kept", kept: true },
    ]);
  });

  it("explains a refused removal by its code", () => {
    const t = (key: string) => key;
    expect(orderRemovalError({ code: "ORDER_HAS_SHIPMENT" }, t)).toBe("removal.error_has_shipment");
    expect(orderRemovalError({ code: "ORDER_NOT_FINISHED" }, t)).toBe("removal.error_not_finished");
    expect(orderRemovalError({ code: "ORDER_CHANGED" }, t)).toBe("removal.error_changed");
    expect(orderRemovalError(new Error("network down"), t)).toBe("network down");
  });
});

const CAPS: CarrierCapabilities = {
  homeDelivery: true, stopDesk: true, separateValidation: false, bulkCreate: 50,
  parcelFields: { weight: true, fragile: true, remarks: true }, limits: { maxAmount: null, maxDescription: null },
  update: true, cancel: true, remarks: { add: true, list: true }, history: true, historyBatch: 50, findByReference: true,
  updates: "pull", label: true, askReturn: true, requestNewAttempt: false, confirmReturn: true, stopDeskList: true, verifyConnection: true,
};

const company = (overrides: Partial<DeliveryCompany>): DeliveryCompany => ({
  id: "c", name: "Packers", nameAr: "-", code: "packers", active: true, isConnected: true, provider: "ecotrack",
  supportsHomeDelivery: true, supportsStopDesk: true, autoValidate: false, capabilities: CAPS, ...overrides,
});

describe("the one fact an order's status card adds", () => {
  const order = (overrides: Partial<Parameters<typeof statusContext>[0]> = {}): Parameters<typeof statusContext>[0] => ({
    status: "new",
    stage: "new",
    callbackAt: null,
    shipmentKind: null,
    carrierName: null,
    driverName: null,
    unansweredCalls: 0,
    confirmedAt: null,
    ...overrides,
  });

  it("says when to call back a customer still waiting, and nothing once the order is decided", () => {
    const at = "2026-11-15T17:00:00.000Z";
    expect(statusContext(order({ callbackAt: at }))).toEqual({ kind: "callback", at });
    expect(statusContext(order({ status: "unreachable", stage: "unreachable", unansweredCalls: 1, callbackAt: at }))).toEqual({ kind: "callback", at });
    expect(statusContext(order({ status: "confirmed", stage: "confirmed", callbackAt: at }))).toBeNull();
    expect(statusContext(order({ status: "cancelled", stage: "cancelled", callbackAt: at }))).toBeNull();
  });

  it("names who carries a shipped order: the carrier or the store's driver", () => {
    expect(statusContext(order({ status: "ready", stage: "in_transit", shipmentKind: "carrier", carrierName: "Yalidine" }))).toEqual({ kind: "carrier", name: "Yalidine" });
    expect(statusContext(order({ status: "ready", stage: "delivered", shipmentKind: "driver", driverName: "Amine B" }))).toEqual({ kind: "driver", name: "Amine B" });
    expect(statusContext(order({ status: "ready", stage: "handoff_pending", shipmentKind: "carrier", carrierName: null }))).toEqual({ kind: "carrier", name: null });
  });

  it("tells how many calls went unanswered before an order was cancelled, unless it had been confirmed", () => {
    expect(statusContext(order({ status: "cancelled", stage: "cancelled", unansweredCalls: 2 }))).toEqual({ kind: "no_answer_cancel", calls: 2 });
    expect(statusContext(order({ status: "cancelled", stage: "cancelled", unansweredCalls: 2, confirmedAt: "2026-11-14T10:00:00.000Z" }))).toBeNull();
    expect(statusContext(order({ status: "cancelled", stage: "cancelled", unansweredCalls: 0 }))).toBeNull();
    expect(statusContext(order({ status: "unreachable", stage: "unreachable", unansweredCalls: 2 }))).toBeNull();
  });

  it("adds nothing to an order with nothing more to say", () => {
    for (const stage of ["new", "confirmed", "preparing", "ready_to_ship"] as const) {
      expect(statusContext(order({ status: stage === "ready_to_ship" ? "ready" : stage, stage }))).toBeNull();
    }
  });
});

describe("handing an order off", () => {
  it("offers only the carriers that can take the parcel now", () => {
    const companies = [
      company({ id: "ok" }),
      company({ id: "off", active: false }),
      company({ id: "unconnected", isConnected: false }),
      company({ id: "no-adapter", provider: null, capabilities: null }),
      company({ id: "home-only", capabilities: { ...CAPS, stopDesk: false } }),
      company({ id: "desk-turned-off", supportsStopDesk: false }),
    ];
    expect(carriersFor(companies, "home").map((c) => c.id)).toEqual(["ok", "home-only", "desk-turned-off"]);
    expect(carriersFor(companies, "stop_desk").map((c) => c.id)).toEqual(["ok"]);
  });

  it("offers for several parcels only the carriers that can take each of them", () => {
    const companies = [company({ id: "both" }), company({ id: "home-only", capabilities: { ...CAPS, stopDesk: false } }), company({ id: "desk-only", capabilities: { ...CAPS, homeDelivery: false } })];
    expect(carriersForAll(companies, ["home", "home"]).map((c) => c.id)).toEqual(["both", "home-only"]);
    expect(carriersForAll(companies, ["stop_desk"]).map((c) => c.id)).toEqual(["both", "desk-only"]);
    expect(carriersForAll(companies, ["home", "stop_desk"]).map((c) => c.id)).toEqual(["both"]);
  });

  it("gives a driver only orders with a street address, bringing stop-desk ones to the door", () => {
    const orders = [
      { id: "home", address: "12 Rue Didouche", deliveryType: "home" as const },
      { id: "desk", address: "5 Cité 200 Logements", deliveryType: "stop_desk" as const },
      { id: "none", address: null, deliveryType: "home" as const },
      { id: "blank", address: "   ", deliveryType: "stop_desk" as const },
    ];
    const plan = driverHandoffPlan(orders);
    expect(plan.deliverable.map((o) => o.id)).toEqual(["home", "desk"]);
    expect(plan.missingAddress.map((o) => o.id)).toEqual(["none", "blank"]);
    expect(plan.deskToDoor.map((o) => o.id)).toEqual(["desk"]);
  });

  it("selects the shippable orders, at most as many as one bulk handoff takes", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`);
    expect(bulkSelection(new Set(), ids(3))).toBe("none");
    expect(bulkSelection(new Set(["o1"]), ids(3))).toBe("some");
    expect(bulkSelection(new Set(ids(3)), ids(3))).toBe("all");
    expect(bulkSelection(new Set(["gone"]), ids(3))).toBe("none");
    expect(bulkSelection(new Set(ids(BULK_HANDOFF_LIMIT)), ids(BULK_HANDOFF_LIMIT + 20))).toBe("all");
    expect(BULK_HANDOFF_LIMIT).toBe(100);
  });

  it("offers only the drivers who take orders", () => {
    const drivers = (["available", "busy", "inactive"] as const).map((status) => ({ id: status, status }) as Driver);
    expect(driversFor(drivers).map((d) => d.id)).toEqual(["available", "busy"]);
  });

  it("offers a carrier handoff for dispatch work, a driver handoff for assignment work", () => {
    expect(handoffKinds(scopes("delivery:dispatch"))).toEqual(["carrier"]);
    expect(handoffKinds(scopes("orders:assign"))).toEqual(["driver"]);
    expect(handoffKinds(scopes("delivery:dispatch", "orders:assign"))).toEqual(["carrier", "driver"]);
    expect(handoffKinds(scopes("orders:read"))).toEqual([]);
  });

  it("says who carries an order", () => {
    expect(deliveredBy({ shipmentKind: "carrier", carrierName: "Yalidine", driverName: null })).toEqual({ kind: "carrier", name: "Yalidine" });
    expect(deliveredBy({ shipmentKind: "driver", carrierName: null, driverName: "Amine B" })).toEqual({ kind: "driver", name: "Amine B" });
    expect(deliveredBy({ shipmentKind: null, carrierName: null, driverName: null })).toBeNull();
  });
});

describe("acting on a shipment", () => {
  it("offers what the server says is open, that the person may do", () => {
    const shipment = { kind: "carrier" as const, actions: ["validate", "label", "void", "sync"] as const };
    expect(offeredActions({ ...shipment, actions: [...shipment.actions] }, scopes("orders:read"))).toEqual(["label"]);
    expect(offeredActions({ ...shipment, actions: [...shipment.actions] }, scopes("orders:read", "delivery:dispatch"))).toEqual(["validate", "label", "void", "sync"]);
  });

  it("never offers an action the server did not open, whatever the permissions", () => {
    expect(offeredActions({ kind: "carrier", actions: ["label"] }, () => true)).toEqual(["label"]);
    expect(offeredActions({ kind: "carrier", actions: [] }, () => true)).toEqual([]);
  });

  it("a driver's shipment is assignment work", () => {
    const driven = { kind: "driver" as const, actions: [...SHIPMENT_ACTIONS].filter((a) => a === "void" || a === "report") };
    expect(offeredActions(driven, scopes("delivery:dispatch"))).toEqual([]);
    expect(offeredActions(driven, scopes("orders:assign"))).toEqual(["void", "report"]);
  });

  it("reports a driver's progress, and on a carrier's parcel only that it came back", () => {
    expect(reportsFor({ kind: "driver" })).toEqual(["out_for_delivery", "failed_attempt", "delivered", "returned"]);
    expect(reportsFor({ kind: "carrier" })).toEqual(["returned"]);
  });

  it("reads our own steps and the driver's progress in the merchant's words, a carrier's status in the carrier's", () => {
    expect(eventLabel({ vocabulary: "codflow", providerStatus: "handoff_outcome_unknown", providerStatusLabel: null })).toEqual({ key: "event.handoff_outcome_unknown" });
    expect(eventLabel({ vocabulary: "driver", providerStatus: "failed_attempt", providerStatusLabel: null })).toEqual({ key: "event.failed_attempt" });
    expect(eventLabel({ vocabulary: "legacy", providerStatus: "dispatched", providerStatusLabel: null })).toEqual({ key: "event.dispatched" });
    expect(eventLabel({ vocabulary: "yalidine", providerStatus: "En attente du client", providerStatusLabel: null })).toEqual({ text: "En attente du client" });
    expect(eventLabel({ vocabulary: "ecotrack", providerStatus: "en_hub", providerStatusLabel: "Au hub" })).toEqual({ text: "Au hub" });
    expect(eventLabel({ vocabulary: "codflow", providerStatus: "something_new", providerStatusLabel: null })).toEqual({ text: "something_new" });
  });

  it("reads the latest status like its history entry", () => {
    const ours = { vocabulary: "driver", providerStatus: "failed_attempt", providerStatusLabel: null, occurredAt: "2026-10-02T08:00:00Z", recordedAt: "2026-10-02T08:00:00Z" } as ShipmentEvent;
    expect(latestStatusLabel({ providerStatus: "failed_attempt", providerStatusLabel: null, events: [ours] })).toEqual({ key: "event.failed_attempt" });
    expect(latestStatusLabel({ providerStatus: "en_hub", providerStatusLabel: "Au hub", events: [] })).toEqual({ text: "Au hub" });
    expect(latestStatusLabel({ providerStatus: null, providerStatusLabel: null, events: [ours] })).toBeNull();
  });

  it("says why a delivery needs the merchant, the most urgent first", () => {
    const flagged = { id: "f", attention: true, reason: "Client injoignable", providerStatusLabel: null, providerStatus: "x", occurredAt: "2026-10-02T08:00:00Z", recordedAt: "2026-10-02T08:00:00Z" } as ShipmentEvent;
    const base = { handoffState: "accepted" as const, cancelledAt: null, attentionSince: null, events: [] };
    expect(attentionReason(base)).toBeNull();
    expect(attentionReason({ ...base, handoffState: "unknown", cancelledAt: "x" })).toEqual({ kind: "unknown_handoff" });
    expect(attentionReason({ ...base, cancelledAt: "x", attentionSince: "x" })).toEqual({ kind: "cancelled_by_carrier" });
    expect(attentionReason({ ...base, attentionSince: "x", events: [flagged] })).toEqual({ kind: "flagged", detail: "Client injoignable" });
    expect(attentionReason({ ...base, attentionSince: "x" })).toEqual({ kind: "flagged", detail: null });
  });

  it("shows the delivery's history newest first", () => {
    const event = (id: string, occurredAt: string, recordedAt = occurredAt) => ({ id, occurredAt, recordedAt }) as ShipmentEvent;
    const timeline = deliveryTimeline({ events: [event("a", "2026-10-01T08:00:00Z"), event("c", "2026-10-02T08:00:00Z"), event("b", "2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z")] });
    expect(timeline.map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(deliveryTimeline({})).toEqual([]);
  });
});

describe("money", () => {
  it("calculates the COD total from product price and delivery fee", () => {
    expect(orderTotal({ price: 9000, deliveryFee: 400 })).toBe(9400);
    expect(formatMoney(9400, "en")).toBe("9,400 DA");
  });
});

/**
 * The "what they were buying" column on the abandoned-checkout list.
 *
 * This list is the merchant's callback queue, so the column has to be good
 * enough to hold the conversation from — which is why a basket lists every
 * line rather than summarising, and why a single-product record refuses to
 * invent a quantity it never stored.
 */
describe("abandonedBasketView", () => {
  const hoodie = {
    productId: "p1",
    productName: "Hoodie Classic",
    variantId: "v-black-l",
    variantLabel: "Noir / L",
    quantity: 2,
    unitPrice: 2400,
  };
  const tshirt = {
    productId: "p2",
    productName: "Street Fighter 45",
    variantId: null,
    variantLabel: null,
    quantity: 1,
    unitPrice: 1000,
  };

  it("lists every line of a basket", () => {
    const view = abandonedBasketView({
      items: [hoodie, tshirt],
      productName: "Hoodie Classic",
      variantLabel: "Noir / L",
    });

    expect(view.kind).toBe("basket");
    if (view.kind !== "basket") return;
    expect(view.lines).toHaveLength(2);
    expect(view.lines[0]).toMatchObject({
      productName: "Hoodie Classic",
      variantLabel: "Noir / L",
      quantity: 2,
    });
    expect(view.lines[1]).toMatchObject({ productName: "Street Fighter 45", quantity: 1 });
  });

  it("gives every line a stable key, even for the same product twice", () => {
    // Same product, two variants, is two lines — React needs distinct keys.
    const view = abandonedBasketView({
      items: [hoodie, { ...hoodie, variantId: "v-black-m", variantLabel: "Noir / M" }],
      productName: null,
      variantLabel: null,
    });

    if (view.kind !== "basket") throw new Error("expected a basket");
    expect(new Set(view.lines.map((l) => l.key)).size).toBe(2);
  });

  it("prefers the basket over the flat fields stored beside it", () => {
    // Basket rows carry BOTH — the flat columns hold the first line so older
    // readers keep working. The basket is the fuller truth.
    const view = abandonedBasketView({
      items: [tshirt],
      productName: "Hoodie Classic",
      variantLabel: "Noir / L",
    });

    if (view.kind !== "basket") throw new Error("expected a basket");
    expect(view.lines[0].productName).toBe("Street Fighter 45");
  });

  it("shows a single-product record without inventing a quantity", () => {
    // The record never stored one. "1×" would be a guess, and the shopper may
    // well have been ordering three.
    const view = abandonedBasketView({
      items: null,
      productName: "Hoodie Classic",
      variantLabel: "Noir / L",
    });

    expect(view).toEqual({
      kind: "product",
      productName: "Hoodie Classic",
      variantLabel: "Noir / L",
    });
  });

  it("treats an empty basket as no basket", () => {
    const view = abandonedBasketView({ items: [], productName: "Hoodie", variantLabel: null });

    expect(view.kind).toBe("product");
  });

  it("says nothing is known when the shopper only left contact details", () => {
    expect(abandonedBasketView({ items: null, productName: null, variantLabel: null })).toEqual({
      kind: "unknown",
    });
  });
});

describe("the receipt's delivery row", () => {
  const t = (key: string) => key;
  const said = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);
  it("shows the fee, or free — naming the offer that made it free", () => {
    expect(deliveryLabel({ deliveryFee: 500, deliveryOfferId: null, deliveryOfferName: null }, t, "en")).toBe(formatMoney(500, "en"));
    expect(deliveryLabel({ deliveryFee: 500, deliveryOfferId: "o1", deliveryOfferName: "Packs" }, t, "en")).toBe(formatMoney(500, "en"));
    expect(deliveryLabel({ deliveryFee: 0, deliveryOfferId: "o1", deliveryOfferName: "Packs" }, said, "en")).toBe(`detail.delivery_free_named ${JSON.stringify({ name: "Packs" })}`);
    expect(deliveryLabel({ deliveryFee: 0, deliveryOfferId: null, deliveryOfferName: "Packs" }, said, "en")).toBe(`detail.delivery_free_named ${JSON.stringify({ name: "Packs" })}`);
    expect(deliveryLabel({ deliveryFee: 0, deliveryOfferId: "o1", deliveryOfferName: null }, t, "en")).toBe("detail.delivery_free_offer");
    expect(deliveryLabel({ deliveryFee: 0, deliveryOfferId: null, deliveryOfferName: null }, t, "en")).toBe("form.free");
  });
});

describe("what an order line says of its offer", () => {
  const said = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);
  it("names the offer as it was when the order was placed, even once it is gone", () => {
    expect(offerLineLabel({ reward: false, offerId: "o1", offerName: "Buy 2" }, said)).toBe(`detail.line_offer_named ${JSON.stringify({ name: "Buy 2" })}`);
    expect(offerLineLabel({ reward: false, offerId: null, offerName: "Buy 2" }, said)).toBe(`detail.line_offer_named ${JSON.stringify({ name: "Buy 2" })}`);
    expect(offerLineLabel({ reward: true, offerId: null, offerName: "Buy 2" }, said)).toBe(`detail.line_reward_named ${JSON.stringify({ name: "Buy 2" })}`);
  });

  it("says only that an offer applied when its name was never kept, and nothing for a plain line", () => {
    expect(offerLineLabel({ reward: true, offerId: null, offerName: null }, said)).toBe("detail.line_reward");
    expect(offerLineLabel({ reward: false, offerId: "o1", offerName: null }, said)).toBe("detail.line_offer");
    expect(offerLineLabel({ reward: false, offerId: null, offerName: null }, said)).toBeNull();
  });
});

describe("an order's items before its coupon", () => {
  it("add the coupon back to the order's price and to each line, the unit price following", () => {
    expect(subtotalBeforeCoupon({ price: 1980, couponDiscount: 220 })).toBe(2200);
    expect(subtotalBeforeCoupon({ price: 1980, couponDiscount: 0 })).toBe(1980);
    expect(subtotalBeforeCoupon({ price: 1980 })).toBe(1980);
    expect(lineBeforeCoupon({ lineTotal: 3600, quantity: 2, discount: 400 })).toEqual({ unit: 2000, total: 4000 });
    expect(lineBeforeCoupon({ lineTotal: 3600, quantity: 2 })).toEqual({ unit: 1800, total: 3600 });
    expect(lineBeforeCoupon({ lineTotal: 0, quantity: 0, discount: 0 })).toEqual({ unit: 0, total: 0 });
  });
});

describe("an order's source", () => {
  type Ad = NonNullable<OrderAttributionView["ad"]>;
  type Visit = NonNullable<OrderAttributionView["visit"]>;
  const AD: Ad = {
    platform: "meta",
    app: "fb",
    clickedAt: "2026-11-12T06:18:00.000Z",
    clickIdType: "fbclid",
    campaignId: "120200000000000001",
    campaignName: "TEST2-campaign",
    adsetId: null,
    adId: "120200000000000003",
    adName: "TEST2-ad",
    placement: "Facebook_Mobile_Feed",
    utmSource: "facebook",
    utmCampaign: "120200000000000001",
    landingPath: "/products/insulated-bottle",
    landingPageType: "product",
  };
  const VISIT: Visit = { at: "2026-11-12T06:19:00.000Z", channel: "direct", platform: "direct", app: null, referrerHost: null, landingPath: "/", landingPageType: "home", utmSource: null, utmMedium: null, utmCampaign: null };
  const APP_NAME = (app: string) => `${app} app on Android`;
const PAGE = (page: StorePage) => (page.name === null ? `[${page.type}]` : `[${page.type}] ${page.name}`);
const APP: SourceLabels = { app: APP_NAME, page: PAGE };

  it("heads with the ad and its app, the social network or search engine, or what the order was", () => {
    expect(sourceHeadline({ channel: "paid_social", platform: "meta", app: "ig" })).toEqual({ key: "paid", network: "ig" });
    expect(sourceHeadline({ channel: "paid_social", platform: "meta", app: null })).toEqual({ key: "paid", network: "meta" });
    expect(sourceHeadline({ channel: "paid_search", platform: "google", app: null })).toEqual({ key: "paid", network: "google" });
    expect(sourceHeadline({ channel: "paid_other", platform: "other", app: null })).toEqual({ key: "paid", network: "other" });
    expect(sourceHeadline({ channel: "organic_social", platform: "meta", app: "fb" })).toEqual({ key: "organic_social", network: "fb" });
    expect(sourceHeadline({ channel: "organic_social", platform: "tiktok", app: null })).toEqual({ key: "organic_social", network: "tiktok" });
    expect(sourceHeadline({ channel: "organic_search", platform: "bing", app: null })).toEqual({ key: "organic_search", network: "bing" });
    for (const channel of ["direct", "referral", "tagged", "email", "dashboard", "api", "agent"] as const) {
      expect(sourceHeadline({ channel, platform: "direct", app: null }), channel).toEqual({ key: channel, network: null });
    }
    expect(sourceHeadline({ channel: null, platform: "direct", app: null })).toBeNull();
    expect(sourceHeadline(null)).toBeNull();
  });

  it("reads Meta's placement as words", () => {
    expect(readablePlacement("Facebook_Mobile_Feed")).toBe("Facebook · Mobile Feed");
    expect(readablePlacement("Instagram_Stories")).toBe("Instagram · Stories");
    expect(readablePlacement("Audience_Network_Rewarded_Video")).toBe("Audience Network · Rewarded Video");
    expect(readablePlacement("Audience_Network")).toBe("Audience Network");
    expect(readablePlacement("Facebook")).toBe("Facebook");
    expect(readablePlacement("Other_Placement")).toBe("Other Placement");
  });

  it("says how long before the order the ad was clicked", () => {
    const at = "2026-11-12T12:00:00.000Z";
    expect(beforeOrder("2026-11-12T11:59:30.000Z", at)).toEqual({ key: "just_before" });
    expect(beforeOrder("2026-11-12T11:59:00.000Z", at)).toEqual({ key: "minutes_before", count: 1 });
    expect(beforeOrder("2026-11-12T11:00:01.000Z", at)).toEqual({ key: "minutes_before", count: 59 });
    expect(beforeOrder("2026-11-12T11:00:00.000Z", at)).toEqual({ key: "hours_before", count: 1 });
    expect(beforeOrder("2026-11-10T12:00:01.000Z", at)).toEqual({ key: "hours_before", count: 47 });
    expect(beforeOrder("2026-11-10T12:00:00.000Z", at)).toEqual({ key: "days_before", count: 2 });
    expect(beforeOrder("2026-11-12T12:05:00.000Z", at)).toEqual({ key: "just_before" });
    expect(beforeOrder("not a date", at)).toEqual({ key: "just_before" });
  });

  it("shows the ad by its names, its placement in words, its landing page and click time", () => {
    expect(adFacts(AD, "en", APP)).toEqual([
      { key: "campaign", value: "TEST2-campaign" },
      { key: "ad", value: "TEST2-ad" },
      { key: "placement", value: "Facebook · Mobile Feed" },
      { key: "landing", value: "[product] insulated-bottle" },
      { key: "clicked_at", value: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(AD.clickedAt!)) },
    ]);
    expect(adFacts({ ...AD, campaignName: null, adName: null, placement: null, landingPath: null, clickedAt: null }, "ar", APP)).toEqual([
      { key: "campaign", value: "120200000000000001" },
      { key: "ad", value: "120200000000000003" },
    ]);
    expect(adFacts({ ...AD, campaignName: null, campaignId: null, utmCampaign: "soldes", adName: null, adId: null, placement: null, landingPath: null, clickedAt: null }, "fr", APP)).toEqual([{ key: "campaign", value: "soldes" }]);
  });

  it("shows this visit by where it came from, its landing page and time", () => {
    expect(visitFacts({ ...VISIT, referrerHost: "l.instagram.com", utmCampaign: "été" }, "en", APP).map((fact) => fact.key)).toEqual(["referrer", "campaign", "landing", "arrived_at"]);
    expect(visitFacts({ ...VISIT, at: null, landingPath: null }, "en", APP)).toEqual([]);
  });

  it("names the Android app a visit came from, and a website by its host", () => {
    const referrer = (referrerHost: string) => visitFacts({ ...VISIT, referrerHost }, "en", APP)[0];
    expect(referrer("com.google.android.googlequicksearchbox")).toEqual({ key: "referrer", value: "Google app on Android" });
    expect(referrer("com.facebook.katana")).toEqual({ key: "referrer", value: "Facebook app on Android" });
    expect(referrer("com.example.unknownapp")).toEqual({ key: "referrer", value: "com.example.unknownapp" });
    expect(referrer("www.google.dz")).toEqual({ key: "referrer", value: "www.google.dz" });
  });

  it("filters by groups that cover every channel once, and the unknown", () => {
    const all = Object.values(SOURCE_FILTERS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...ORDER_CHANNELS, "unknown"].sort());
  });

  it("names the storefront page a visit landed on by its type and slug, never as a raw path", () => {
    expect(storePage("/products/robe-qa", "product")).toEqual({ type: "product", name: "robe-qa" });
    expect(storePage("/fr/lp/robe-%C3%A9t%C3%A9", "landing")).toEqual({ type: "landing", name: "robe-été" });
    expect(storePage("/lp/%E0%A4%A", "landing")).toEqual({ type: "landing", name: "%E0%A4%A" });
    expect(storePage("/", "home")).toEqual({ type: "home", name: null });
    expect(storePage("/checkout", "checkout")).toEqual({ type: "checkout", name: null });
    expect(storePage("/old-page", null)).toEqual({ type: "other", name: "/old-page" });
    expect(storePage(null, "home")).toBeNull();
    expect(visitFacts({ ...VISIT, landingPath: "/lp/robe-ete", landingPageType: "landing" }, "en", APP).find((fact) => fact.key === "landing")).toEqual({ key: "landing", value: "[landing] robe-ete" });
  });

  it("names Snapchat as its own network, and an AI assistant by its own headline and filter", () => {
    expect(sourceHeadline({ channel: "paid_social", platform: "snapchat", app: null })).toEqual({ key: "paid", network: "snapchat" });
    expect(sourceHeadline({ channel: "ai_assistant", platform: "other", app: null })).toEqual({ key: "ai_assistant", network: null });
    expect(SOURCE_FILTERS.ai).toEqual(["ai_assistant"]);
  });
});

describe("an order's journey: the visits that led to it, oldest first", () => {
  type View = Parameters<typeof sourceJourney>[0];
  const visit = (at: string, channel: NonNullable<View["visit"]>["channel"], platform: AttributionPlatform = "direct") => ({
    at,
    channel,
    platform,
    app: null,
    referrerHost: null,
    landingPath: "/",
    landingPageType: "home",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
  });
  const ad = (clickedAt: string) => ({
    platform: "meta" as const,
    app: "ig",
    clickedAt,
    clickIdType: null,
    campaignId: null,
    campaignName: "Summer",
    adsetId: null,
    adId: null,
    adName: "Reel 1",
    placement: "Instagram_Reels",
    utmSource: "facebook",
    utmCampaign: null,
    landingPath: "/products/robe",
    landingPageType: "product",
  });
  const view = (over: Partial<View>): View => ({ channel: "direct", platform: "direct", app: null, ad: null, visit: null, earlier: null, first: null, ...over });
  const steps = (v: View) => sourceJourney(v).map((step) => `${step.kind}:${step.source.channel}${step.credited ? ":credited" : ""}${step.ordered ? ":ordered" : ""}`);

  it("is one credited step when the shopper ordered in the visit that is the source", () => {
    const search = visit("2026-11-13T10:00:00.000Z", "organic_search", "google");
    expect(steps(view({ channel: "organic_search", platform: "google", visit: search, first: search }))).toEqual(["visit:organic_search:credited:ordered"]);
  });

  it("merges the ad and the visit the shopper ordered in when they are one visit", () => {
    const at = "2026-11-13T10:00:00.000Z";
    expect(steps(view({ channel: "paid_social", platform: "meta", app: "ig", ad: ad(at), visit: visit(at, "paid_social", "meta"), first: visit(at, "paid_social", "meta") }))).toEqual(["ad:paid_social:credited:ordered"]);
  });

  it("keeps the credited ad, then a later visit, apart", () => {
    const steps_ = sourceJourney(view({ channel: "paid_social", platform: "meta", app: "ig", ad: ad("2026-11-11T10:00:00.000Z"), visit: visit("2026-11-13T10:00:00.000Z", "organic_search", "google") }));
    expect(steps_.map((s) => [s.kind, s.source.channel, s.source.platform, s.credited, s.ordered])).toEqual([
      ["ad", "paid_social", "meta", true, false],
      ["visit", "organic_search", "google", false, true],
    ]);
    expect(steps_.map((s) => s.at)).toEqual(["2026-11-11T10:00:00.000Z", "2026-11-13T10:00:00.000Z"]);
  });

  it("credits the earlier visit a direct return comes from, and starts with the first visit when it is another", () => {
    const first = visit("2026-11-01T10:00:00.000Z", "referral");
    const email = visit("2026-11-13T10:00:00.000Z", "email");
    expect(steps(view({ channel: "email", platform: "other", earlier: email, visit: visit("2026-11-13T11:00:00.000Z", "direct"), first }))).toEqual([
      "first:referral",
      "earlier:email:credited",
      "visit:direct:ordered",
    ]);
  });

  it("leaves out a first visit that is already a step", () => {
    const email = visit("2026-11-13T10:00:00.000Z", "email");
    expect(steps(view({ channel: "email", platform: "other", earlier: email, visit: visit("2026-11-13T11:00:00.000Z", "direct"), first: email }))).toEqual(["earlier:email:credited", "visit:direct:ordered"]);
  });

  it("has no steps for an order entered by the team or one whose source is unknown", () => {
    expect(sourceJourney(view({ channel: "dashboard", platform: "none" }))).toEqual([]);
    expect(sourceJourney(view({ channel: null }))).toEqual([]);
  });
});
