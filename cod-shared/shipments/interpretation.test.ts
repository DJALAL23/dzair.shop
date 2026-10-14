import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EMPTY_DELIVERY_FACTS,
  MILESTONES,
  applyEvent,
  checkVoid,
  isClosed,
  type AppliedEvent,
  type DeliveryFacts,
  type Interpretation,
  type Milestone,
  type ObservedStatus,
} from "./interpretation";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 8, 0) + minute * 60_000).toISOString();

const ev = (providerStatus: string, interpretation: Interpretation, minute: number): ObservedStatus => ({
  providerStatus,
  interpretation,
  occurredAt: at(minute),
});

const progress: Interpretation = { kind: "progress" };
const ofd: Interpretation = { kind: "milestone", milestone: "out_for_delivery" };
const delivered: Interpretation = { kind: "milestone", milestone: "delivered" };
const returnStarted: Interpretation = { kind: "milestone", milestone: "return_started" };
const returnToCollect: Interpretation = { kind: "milestone", milestone: "return_started", attention: true };
const returned: Interpretation = { kind: "milestone", milestone: "returned" };
const cancelled: Interpretation = { kind: "milestone", milestone: "cancelled" };
const failed: Interpretation = { kind: "failed_attempt" };
const exception: Interpretation = { kind: "exception" };
const collection: Interpretation = { kind: "collection" };
const unknown: Interpretation = { kind: "unknown" };

/** Apply reports in arrival order, keeping each step's result. */
function run(events: readonly ObservedStatus[], start: DeliveryFacts = EMPTY_DELIVERY_FACTS) {
  const steps: AppliedEvent[] = [];
  let facts = start;
  for (const event of events) {
    const step = applyEvent(facts, event);
    steps.push(step);
    facts = step.next;
  }
  return { facts, steps, reached: steps.flatMap((s) => s.reached), anomalies: steps.map((s) => s.anomaly).filter(Boolean) };
}

describe("applyEvent — journeys carriers actually report", () => {
  it("Yalidine home delivery with one failed attempt", () => {
    const { facts, reached } = run([
      ev("Expédié", progress, 0),
      ev("Sorti en livraison", ofd, 10),
      ev("Tentative échouée", failed, 20),
      ev("Sorti en livraison", ofd, 30),
      ev("Livré", delivered, 40),
    ]);
    expect(reached).toEqual(["out_for_delivery", "delivered"]);
    expect(facts).toMatchObject({
      providerStatus: "Livré",
      providerStatusKind: "milestone",
      outForDeliveryAt: at(10),
      deliveredAt: at(40),
      deliveryAttempts: 1,
      attentionSince: null,
    });
    expect(isClosed(facts)).toBe(true);
  });

  it("a refused parcel comes back: return started, waits for the merchant, then returns", () => {
    const first = run([
      ev("Sorti en livraison", ofd, 0),
      ev("Echèc livraison", returnStarted, 10),
      ev("Retour à retirer", returnToCollect, 20),
    ]);
    expect(first.facts.returnStartedAt).toBe(at(10));
    expect(first.facts.returnedAt).toBeNull();
    expect(first.facts.attentionSince).toBe(at(20));

    const done = run([ev("Retourné au vendeur", returned, 30)], first.facts);
    expect(done.reached).toEqual(["returned"]);
    expect(done.facts.returnedAt).toBe(at(30));
    expect(done.facts.attentionSince).toBeNull();
  });

  it("a stop-desk parcel whose return started is still delivered when the customer collects late", () => {
    const { facts, anomalies } = run([
      ev("En attente du client", ofd, 0),
      ev("Retour à retirer", returnToCollect, 10),
      ev("Livré", delivered, 20),
    ]);
    expect(anomalies).toEqual([]);
    expect(facts.returnStartedAt).toBe(at(10));
    expect(facts.deliveredAt).toBe(at(20));
    expect(facts.attentionSince).toBeNull();
  });

  it("EcoTrack: collected and paid statuses after delivery keep it delivered and update the current status", () => {
    const { facts, reached, anomalies } = run([
      ev("livred", delivered, 0),
      ev("encaissed", collection, 60),
      ev("payed", collection, 120),
    ]);
    expect(reached).toEqual(["delivered"]);
    expect(anomalies).toEqual([]);
    expect(facts.deliveredAt).toBe(at(0));
    expect(facts.providerStatus).toBe("payed");
    expect(facts.providerStatusKind).toBe("collection");
  });

  it("a payout reported before the delivery does not become the delivery time", () => {
    const { facts, reached } = run([
      ev("paye_et_archive", collection, 300),
      ev("livred", delivered, 100),
    ]);
    expect(reached).toEqual(["delivered"]);
    expect(facts.deliveredAt).toBe(at(100));
    expect(facts.providerStatus).toBe("paye_et_archive");
  });

  it("a delivery reported before its out-for-delivery still records the earlier step", () => {
    const { facts, reached } = run([ev("Livré", delivered, 20), ev("Sorti en livraison", ofd, 10)]);
    expect(reached).toEqual(["delivered", "out_for_delivery"]);
    expect(facts.outForDeliveryAt).toBe(at(10));
    expect(facts.providerStatus).toBe("Livré");
  });

  it("a carrier cancellation before pickup closes the shipment", () => {
    const { facts, reached } = run([ev("Pas encore ramassé", progress, 0), ev("Annulé", cancelled, 5)]);
    expect(reached).toEqual(["cancelled"]);
    expect(isClosed(facts)).toBe(true);
  });
});

describe("applyEvent — contradictions are recorded, never applied", () => {
  it("returned after delivered", () => {
    const { facts, anomalies } = run([ev("Livré", delivered, 0), ev("Retourné au vendeur", returned, 10)]);
    expect(anomalies).toEqual(["conflicting_outcome"]);
    expect(facts.returnedAt).toBeNull();
    expect(facts.deliveredAt).toBe(at(0));
  });

  it("cash collected on a parcel that came back", () => {
    const { facts, anomalies } = run([ev("retour_recu", returned, 0), ev("encaisse_non_paye", collection, 10)]);
    expect(anomalies).toEqual(["collection_after_return"]);
    expect(facts.deliveredAt).toBeNull();
  });

  it("a cancellation after the final mile", () => {
    const { facts, anomalies } = run([ev("Sorti en livraison", ofd, 0), ev("Annulé", cancelled, 10)]);
    expect(anomalies).toEqual(["cancelled_after_out_for_delivery"]);
    expect(facts.cancelledAt).toBeNull();
  });

  it("an out-for-delivery reaching a cancelled shipment", () => {
    const { facts, anomalies } = run([ev("Annulé", cancelled, 10), ev("Sorti en livraison", ofd, 5)]);
    expect(anomalies).toEqual(["cancelled_after_out_for_delivery"]);
    expect(facts.outForDeliveryAt).toBeNull();
  });

  it("a milestone dated after the closure", () => {
    const { facts, anomalies } = run([ev("Livré", delivered, 10), ev("Retour vers centre", returnStarted, 20)]);
    expect(anomalies).toEqual(["after_closure"]);
    expect(facts.returnStartedAt).toBeNull();
  });
});

describe("applyEvent — attempts and attention", () => {
  it("counts a late-arriving attempt from before the closure, ignores one after it", () => {
    const { facts } = run([
      ev("Livré", delivered, 30),
      ev("Tentative échouée", failed, 20),
      ev("Tentative échouée", failed, 40),
    ]);
    expect(facts.deliveryAttempts).toBe(1);
  });

  it("opens on an exception and closes when an ordinary status becomes current", () => {
    const flagged = run([ev("En alerte", exception, 10)]).facts;
    expect(flagged.attentionSince).toBe(at(10));
    expect(run([ev("Alerte résolue", progress, 20)], flagged).facts.attentionSince).toBeNull();
  });

  it("closes when the shipment closes, even if the closing report arrives late behind an alert", () => {
    const { facts } = run([ev("En alerte", exception, 20), ev("Livré", delivered, 10)]);
    expect(facts.providerStatus).toBe("En alerte");
    expect(facts.deliveredAt).toBe(at(10));
    expect(facts.attentionSince).toBeNull();
  });

  it("is not reopened by an older exception arriving late", () => {
    const { facts } = run([ev("Centre", progress, 20), ev("En alerte", exception, 10)]);
    expect(facts.attentionSince).toBeNull();
    expect(facts.providerStatus).toBe("Centre");
  });

  it("a newer status we do not recognize is current and sets no milestone", () => {
    const { facts, reached } = run([ev("En alerte", exception, 10), ev("Nouveau statut", unknown, 20)]);
    expect(reached).toEqual([]);
    expect(facts.providerStatus).toBe("Nouveau statut");
    expect(facts.providerStatusKind).toBe("unknown");
    expect(facts.attentionSince).toBeNull();
  });

  it("on equal times the later arrival is current", () => {
    const { facts } = run([ev("Centre", progress, 10), ev("Vers Wilaya", progress, 10)]);
    expect(facts.providerStatus).toBe("Vers Wilaya");
  });
});

// ─── Properties ───────────────────────────────────────────────────────────────

const MILESTONE_FIELD: Record<Milestone, keyof DeliveryFacts> = {
  out_for_delivery: "outForDeliveryAt",
  delivered: "deliveredAt",
  return_started: "returnStartedAt",
  returned: "returnedAt",
  cancelled: "cancelledAt",
};

const anyInterpretation: fc.Arbitrary<Interpretation> = fc.oneof(
  fc.constantFrom(...MILESTONES).map((milestone) => ({ kind: "milestone" as const, milestone })),
  fc.constantFrom(...MILESTONES).map((milestone) => ({ kind: "milestone" as const, milestone, attention: true })),
  fc.constantFrom<Interpretation>(failed, exception, collection, progress, unknown),
);

const anyEvents = fc.array(
  fc.record({
    providerStatus: fc.string({ minLength: 1, maxLength: 6 }),
    interpretation: anyInterpretation,
    occurredAt: fc.integer({ min: 0, max: 50 }).map(at),
  }),
  { maxLength: 25 },
);

describe("applyEvent — invariants for any reports, however inconsistent", () => {
  it("a shipment closes at most one way, and a carrier-cancelled one never went out for delivery", () => {
    fc.assert(
      fc.property(anyEvents, (events) => {
        const { facts } = run(events);
        const closings = [facts.deliveredAt, facts.returnedAt, facts.cancelledAt].filter((v) => v !== null);
        expect(closings.length).toBeLessThanOrEqual(1);
        if (facts.cancelledAt !== null) expect(facts.outForDeliveryAt).toBeNull();
      }),
    );
  });

  it("milestones are never cleared, only moved earlier, and always to a reported time", () => {
    fc.assert(
      fc.property(anyEvents, (events) => {
        const { steps } = run(events);
        let previous = EMPTY_DELIVERY_FACTS;
        for (const step of steps) {
          for (const m of MILESTONES) {
            const before = previous[MILESTONE_FIELD[m]] as string | null;
            const after = step.next[MILESTONE_FIELD[m]] as string | null;
            if (before !== null) {
              expect(after).not.toBeNull();
              expect(after! <= before).toBe(true);
            }
            if (after !== null) expect(events.some((e) => e.occurredAt === after)).toBe(true);
          }
          previous = step.next;
        }
      }),
    );
  });

  it("each milestone reaches consumers exactly once, and only milestones that are set", () => {
    fc.assert(
      fc.property(anyEvents, (events) => {
        const { facts, reached } = run(events);
        expect(new Set(reached).size).toBe(reached.length);
        const set = MILESTONES.filter((m) => facts[MILESTONE_FIELD[m]] !== null);
        expect([...reached].sort()).toEqual([...set].sort());
      }),
    );
  });

  it("the current status is the newest report, the later arrival on a tie", () => {
    fc.assert(
      fc.property(anyEvents.filter((e) => e.length > 0), (events) => {
        const { facts } = run(events);
        const newest = events.reduce((a, b) => (b.occurredAt >= a.occurredAt ? b : a));
        expect(facts.providerStatus).toBe(newest.providerStatus);
        expect(facts.providerStatusAt).toBe(newest.occurredAt);
      }),
    );
  });

  it("never counts more attempts than failed attempts reported", () => {
    fc.assert(
      fc.property(anyEvents, (events) => {
        const { facts } = run(events);
        const failures = events.filter((e) => e.interpretation.kind === "failed_attempt").length;
        expect(facts.deliveryAttempts).toBeLessThanOrEqual(failures);
      }),
    );
  });
});

/**
 * A timeline that could really happen: strictly increasing times, at most one
 * outcome, and only steps that make sense before it.
 */
const consistentTimeline: fc.Arbitrary<ObservedStatus[]> = fc
  .record({
    outcome: fc.constantFrom("delivered", "returned", "cancelled", "open"),
    before: fc.array(fc.constantFrom<Interpretation>(progress, exception), { maxLength: 3 }),
    finalMile: fc.boolean(),
    attempts: fc.integer({ min: 0, max: 3 }),
    returnFirst: fc.boolean(),
    after: fc.array(fc.constantFrom<Interpretation>(progress, collection), { maxLength: 2 }),
    endsFlagged: fc.boolean(),
  })
  .map(({ outcome, before, finalMile, attempts, returnFirst, after, endsFlagged }) => {
    const steps: Interpretation[] = [...before];
    if (outcome === "cancelled") {
      steps.push(cancelled);
    } else {
      if (finalMile || outcome === "delivered") steps.push(ofd);
      for (let i = 0; i < attempts; i++) steps.push(failed);
      if (outcome === "delivered") {
        if (returnFirst) steps.push(returnToCollect);
        steps.push(delivered, ...after);
      } else if (outcome === "returned") {
        steps.push(returnStarted, returned, ...after.filter((s) => s.kind !== "collection"));
      } else if (endsFlagged) {
        steps.push(exception);
      }
    }
    return steps.map((interpretation, i) => ev(`s${i}`, interpretation, i * 7));
  });

const comparable = (facts: DeliveryFacts) => ({ ...facts, attentionSince: facts.attentionSince !== null });

describe("applyEvent — order independence", () => {
  it("any arrival order of a consistent timeline yields the same facts as the true order", () => {
    fc.assert(
      fc.property(
        consistentTimeline.chain((timeline) =>
          fc.tuple(fc.constant(timeline), fc.shuffledSubarray(timeline, { minLength: timeline.length, maxLength: timeline.length })),
        ),
        ([inOrder, shuffled]) => {
          const truth = run(inOrder);
          const arrived = run(shuffled);
          expect(arrived.anomalies).toEqual([]);
          expect(comparable(arrived.facts)).toEqual(comparable(truth.facts));
          expect([...arrived.reached].sort()).toEqual([...truth.reached].sort());
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("checkVoid", () => {
  const T = at(0);
  it("allows undoing a shipment that never reached the customer", () => {
    expect(checkVoid(EMPTY_DELIVERY_FACTS)).toEqual({ ok: true });
    expect(checkVoid({ ...EMPTY_DELIVERY_FACTS, cancelledAt: T })).toEqual({ ok: true });
  });

  it("refuses once the parcel is in the final mile or coming back", () => {
    expect(checkVoid({ ...EMPTY_DELIVERY_FACTS, outForDeliveryAt: T })).toEqual({ ok: false, code: "SHIPMENT_NOT_VOIDABLE" });
    expect(checkVoid({ ...EMPTY_DELIVERY_FACTS, returnStartedAt: T })).toEqual({ ok: false, code: "SHIPMENT_NOT_VOIDABLE" });
  });

  it("refuses a delivered or returned shipment", () => {
    expect(checkVoid({ ...EMPTY_DELIVERY_FACTS, deliveredAt: T })).toEqual({ ok: false, code: "SHIPMENT_CLOSED" });
    expect(checkVoid({ ...EMPTY_DELIVERY_FACTS, returnedAt: T })).toEqual({ ok: false, code: "SHIPMENT_CLOSED" });
  });
});
