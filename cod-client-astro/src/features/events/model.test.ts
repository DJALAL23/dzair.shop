import { describe, expect, it } from "vitest";
import { REPLAY_MAX_EVENTS as SERVER_REPLAY_MAX } from "../../../../cod-shared/events/deliveries";
import { actorLabel, canRetry, consumerStatus, coveredByWider, endpointProblem, eventByline, kindLabelKey, actionError, pickPattern, REPLAY_MAX_EVENTS, replayRangeProblem, suggestedReplayRange, tightSubscription, typesOf, webhookChange, orderEventsAccess } from "./model";
import type { BusinessEvent, EventConsumer, EventDelivery } from "./types";

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

const consumer = (over: Partial<EventConsumer> = {}): EventConsumer => ({
  id: "c", kind: "meta_capi", name: "Meta", enabled: true, subscription: ["*"], catalogueVersion: 1, builtIn: true, disabledReason: null, failingSince: null,
  deliveries: { due: 0, dead: 0 }, webhook: null, createdAt: "", updatedAt: "", ...over,
});
const delivery = (sequence: number, state: EventDelivery["state"]): EventDelivery => ({
  id: `d${sequence}`, consumerId: "c", state, attempts: 1, nextAttemptAt: null, lastError: null, createdAt: "", settledAt: null,
  event: { id: `e${sequence}`, sequence, type: "order.created", orderId: "o", occurredAt: "" },
});

describe("who and through what", () => {
  it("names staff and carriers, and says an agent acts for a staff member", () => {
    expect(actorLabel({ kind: "staff", id: "u", name: "Nadia" }, t)).toBe("Nadia");
    expect(actorLabel({ kind: "carrier", id: "y", name: "Yalidine" }, t)).toBe("Yalidine");
    expect(actorLabel({ kind: "agent", id: "u", name: "Nadia" }, t)).toBe("actor.agent(name=Nadia)");
    expect(actorLabel({ kind: "shopper", id: null, name: null }, t)).toBe("actor.shopper");
    expect(actorLabel({ kind: "system", id: null, name: null }, t)).toBe("actor.system");
  });

  it("joins them with the origin", () => {
    const event = { actor: { kind: "shopper", id: null, name: null }, origin: "storefront" } as BusinessEvent;
    expect(eventByline(event, t)).toBe("byline(who=actor.shopper,through=origin.storefront)");
  });
});

describe("a Consumer's state", () => {
  it.each([
    [{}, "active"],
    [{ failingSince: "2026-10-24T00:00:00Z" }, "failing"],
    [{ enabled: false, disabledReason: "merchant" as const }, "stopped_by_merchant"],
    [{ enabled: false, disabledReason: "failing" as const }, "stopped_failing"],
    [{ enabled: false, disabledReason: "gone" as const }, "stopped_gone"],
  ])("%o is %s", (over, status) => {
    expect(consumerStatus(consumer(over))).toBe(status);
  });

  it("names only the kinds it knows", () => {
    expect(kindLabelKey("meta_capi")).toBe("kinds.meta_capi");
    expect(kindLabelKey("carrier_pigeon")).toBeNull();
  });
});

describe("delivering again", () => {
  it("retries a settled Delivery of a running Consumer only", () => {
    expect(canRetry(delivery(1, "dead"), consumer())).toBe(true);
    expect(canRetry(delivery(1, "delivered"), consumer())).toBe(true);
    expect(canRetry(delivery(1, "due"), consumer())).toBe(false);
    expect(canRetry(delivery(1, "dead"), consumer({ enabled: false }))).toBe(false);
  });

  it("opens a Replay on the dead ones, else on everything listed", () => {
    expect(suggestedReplayRange([delivery(9, "delivered"), delivery(7, "dead"), delivery(4, "dead"), delivery(2, "delivered")])).toEqual({ fromSequence: 4, toSequence: 7 });
    expect(suggestedReplayRange([delivery(9, "delivered"), delivery(2, "skipped")])).toEqual({ fromSequence: 2, toSequence: 9 });
    expect(suggestedReplayRange([])).toBeNull();
  });

  it("checks a typed range as the server does", () => {
    expect(REPLAY_MAX_EVENTS).toBe(SERVER_REPLAY_MAX);
    expect(replayRangeProblem(3, 3)).toBeNull();
    expect(replayRangeProblem(1, REPLAY_MAX_EVENTS)).toBeNull();
    expect(replayRangeProblem(1, REPLAY_MAX_EVENTS + 1)).toBe("too_long");
    expect(replayRangeProblem(5, 4)).toBe("reversed");
    expect(replayRangeProblem(0, 4)).toBe("not_whole");
    expect(replayRangeProblem(1.5, 4)).toBe("not_whole");
    expect(replayRangeProblem(Number.NaN, 4)).toBe("not_whole");
  });

  it("words the server's refusals, and anything else as a general failure", () => {
    expect(actionError({ code: "EVENT_CONSUMER_DISABLED" }, t)).toBe("errors.consumer_disabled");
    expect(actionError({ code: "EVENT_DELIVERY_ALREADY_DUE" }, t)).toBe("errors.already_due");
    expect(actionError(new Error("offline"), t)).toBe("errors.generic");
    expect(actionError(null, t)).toBe("errors.generic");
  });

  it("words every refusal a webhook action can meet, and nothing it does not know", () => {
    expect(actionError({ code: "EVENT_CONSUMER_BUILT_IN" }, t)).toBe("errors.built_in");
    expect(actionError({ code: "EVENT_CONSUMER_LIMIT_REACHED" }, t)).toBe("errors.limit_reached");
    expect(actionError({ code: "EVENT_CONSUMER_NOT_FOUND" }, t)).toBe("errors.not_found");
    expect(actionError({ code: "VALIDATION_FAILED" }, t)).toBe("errors.invalid");
    expect(actionError({ code: "constructor" }, t)).toBe("errors.generic");
    expect(actionError({ code: 409 }, t)).toBe("errors.generic");
  });
});

describe("picking what a webhook receives", () => {
  it("lists each subject's types in the catalogue's order", () => {
    expect(typesOf("shipment")[0]).toBe("shipment.handed_off");
    expect(typesOf("order")).toContain("order.line_returned");
    expect(typesOf("order").every((type) => type.startsWith("order."))).toBe(true);
  });

  it("knows what a wider pattern covers", () => {
    expect(coveredByWider(["*"], "order.created")).toBe(true);
    expect(coveredByWider(["*"], "order.*")).toBe(true);
    expect(coveredByWider(["*"], "*")).toBe(false);
    expect(coveredByWider(["order.*"], "order.created")).toBe(true);
    expect(coveredByWider(["order.*"], "shipment.delivered")).toBe(false);
    expect(coveredByWider(["order.*"], "order.*")).toBe(false);
    expect(coveredByWider(["order.created"], "order.created")).toBe(false);
  });

  it("keeps a Subscription tight, in order, and never widens it", () => {
    expect(tightSubscription(["shipment.delivered", "order.created", "order.created"])).toEqual(["order.created", "shipment.delivered"]);
    expect(tightSubscription(["order.created", "order.*", "shipment.delivered"])).toEqual(["order.*", "shipment.delivered"]);
    expect(tightSubscription(["shipment.*", "*", "order.created"])).toEqual(["*"]);
    expect(tightSubscription(typesOf("order"))).toEqual(typesOf("order"));
  });

  it("ticks and unticks a pattern", () => {
    expect(pickPattern([], "order.created", true)).toEqual(["order.created"]);
    expect(pickPattern(["order.created", "order.ready"], "order.*", true)).toEqual(["order.*"]);
    expect(pickPattern(["order.*"], "order.*", false)).toEqual([]);
    expect(pickPattern(["order.*", "shipment.delivered"], "*", true)).toEqual(["*"]);
    expect(pickPattern(["*"], "*", false)).toEqual([]);
    expect(pickPattern(["order.created", "shipment.delivered"], "order.created", false)).toEqual(["shipment.delivered"]);
  });

  it("leaves a pattern a wider one covers as it is", () => {
    expect(pickPattern(["order.*"], "order.created", false)).toEqual(["order.*"]);
    expect(pickPattern(["*"], "shipment.*", false)).toEqual(["*"]);
  });
});

describe("an endpoint URL", () => {
  it("is judged as the server judges it, the spaces around it aside", () => {
    expect(endpointProblem("  https://erp.example.dz/hooks ")).toBeNull();
    expect(endpointProblem("http://erp.example.dz/")).toBe("not_https");
    expect(endpointProblem("https://192.168.1.4/")).toBe("private_host");
    expect(endpointProblem("erp")).toBe("invalid");
  });
});

describe("an edit to a webhook", () => {
  const hook = consumer({ kind: "webhook", builtIn: false, name: "ERP", subscription: ["order.*", "shipment.delivered"], webhook: { url: "https://erp.example.dz/", signingSecret: "••••abcd", secretRotatedAt: null, previousSecretSignsUntil: null } });

  it("sends nothing it did not change, the Subscription compared in its tightest form", () => {
    expect(webhookChange(hook, { name: "ERP", url: "https://erp.example.dz/", subscription: ["shipment.delivered", "order.*", "order.created"] })).toEqual({});
  });

  it("compares the Subscription as it is stored, however its patterns were ordered", () => {
    const stored = { ...hook, subscription: ["shipment.delivered", "order.*"] as typeof hook.subscription };
    expect(webhookChange(stored, { name: "ERP", url: "https://erp.example.dz/", subscription: ["order.*", "shipment.delivered"] })).toEqual({});
  });

  it("sends each field it did change", () => {
    expect(webhookChange(hook, { name: "ERP 2", url: "https://erp2.example.dz/", subscription: ["*"] })).toEqual({ name: "ERP 2", url: "https://erp2.example.dz/", subscription: ["*"] });
    expect(webhookChange(hook, { name: "ERP", url: "https://erp.example.dz/", subscription: ["order.*"] })).toEqual({ subscription: ["order.*"] });
  });
});

describe("an order's events, by who is looking", () => {
  const holding = (...scopes: string[]) => (scope: string) => scopes.includes(scope);

  it("opens who received an event to whoever may see some Consumer, and sends only Integrations' readers on to them", () => {
    expect(orderEventsAccess(holding("integrations:read"))).toEqual({ canSeeDeliveries: true, canOpenIntegrations: true });
    expect(orderEventsAccess(holding("meta:read"))).toEqual({ canSeeDeliveries: true, canOpenIntegrations: false });
    expect(orderEventsAccess(holding("orders:read", "settings:integrations", "meta:manage"))).toEqual({ canSeeDeliveries: false, canOpenIntegrations: false });
  });
});
