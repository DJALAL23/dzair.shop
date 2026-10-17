import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { SHIPMENT_ACTIONS } from "../../../../cod-shared/shipments/actions";
import {
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
  deliveryTimeline,
  driversFor,
  formatMoney,
  latestStatusLabel,
  handoffKinds,
  offeredActions,
  ORDER_QUEUES,
  orderTotal,
  lineBeforeCoupon,
  deliveryLabel,
  offerLineLabel,
  subtotalBeforeCoupon,
  queueOf,
  reportsFor,
  statusMoves,
  viewCounts,
  viewQuery,
  type May,
} from "./model";
import type { CarrierCapabilities, DeliveryCompany, Driver, ShipmentEvent } from "./types";

const scopes = (...granted: string[]): May => (scope) => granted.includes(scope);

describe("the order list's work queues", () => {
  it("puts every stage in exactly one queue", () => {
    const placed = ORDER_QUEUES.flatMap((queue) => queue.stages);
    expect([...placed].sort()).toEqual([...ORDER_STAGES].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("follows the merchant's day, and sends a parcel the carrier cancelled back to be shipped", () => {
    expect(ORDER_QUEUES.map((queue) => queue.key)).toEqual(["to_confirm", "to_prepare", "to_ship", "on_the_way", "delivered", "returns", "cancelled"]);
    expect(queueOf("unreachable")).toBe("to_confirm");
    expect(queueOf("delivery_cancelled")).toBe("to_ship");
    expect(queueOf("handoff_pending")).toBe("on_the_way");
    expect(queueOf("returning")).toBe("returns");
  });

  it("asks the server for a queue's stages, or for what needs attention", () => {
    expect(viewQuery("all")).toEqual({});
    expect(viewQuery("attention")).toEqual({ attention: true });
    expect(viewQuery("archived")).toEqual({ archived: true });
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
    });
    expect(counts).toEqual({ all: 11, attention: 2, archived: 0, to_confirm: 5, to_prepare: 0, to_ship: 1, on_the_way: 5, delivered: 0, returns: 0, cancelled: 0 });
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
  updates: "pull", label: true, askReturn: true, requestNewAttempt: false, confirmReturn: true, stopDeskList: true, geoNames: false, verifyConnection: true,
};

const company = (overrides: Partial<DeliveryCompany>): DeliveryCompany => ({
  id: "c", name: "Packers", nameAr: "-", code: "packers", active: true, isConnected: true, provider: "ecotrack",
  supportsHomeDelivery: true, supportsStopDesk: true, autoValidate: false, capabilities: CAPS, ...overrides,
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
