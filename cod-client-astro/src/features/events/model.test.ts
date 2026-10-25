import { describe, expect, it } from "vitest";
import { REPLAY_MAX_EVENTS as SERVER_REPLAY_MAX } from "../../../../cod-shared/events/deliveries";
import { actorLabel, canRetry, consumerStatus, eventByline, kindLabelKey, redeliveryError, REPLAY_MAX_EVENTS, replayRangeProblem, suggestedReplayRange } from "./model";
import type { BusinessEvent, EventConsumer, EventDelivery } from "./types";

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

const consumer = (over: Partial<EventConsumer> = {}): EventConsumer => ({
  id: "c", kind: "meta_capi", name: "Meta", enabled: true, subscription: ["*"], catalogueVersion: 1, disabledReason: null, failingSince: null,
  deliveries: { due: 0, dead: 0 }, createdAt: "", updatedAt: "", ...over,
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
    expect(redeliveryError({ code: "EVENT_CONSUMER_DISABLED" }, t)).toBe("errors.consumer_disabled");
    expect(redeliveryError({ code: "EVENT_DELIVERY_ALREADY_DUE" }, t)).toBe("errors.already_due");
    expect(redeliveryError(new Error("offline"), t)).toBe("errors.generic");
    expect(redeliveryError(null, t)).toBe("errors.generic");
  });
});
