import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addDays } from "../time/store-day";
import { planChange, type CostChange, type CostMoney, type PlannedVersion } from "./versions";

const DAY0 = "2026-01-01";
const on = (n: number) => addDays(DAY0, n);

const version = (over: Partial<PlannedVersion>): PlannedVersion => ({
  id: "v1",
  validFrom: "2026-09-01",
  validTo: null,
  charge: "monthly",
  amountMinor: 3_000_000,
  currency: "DZD",
  productId: null,
  productName: null,
  ...over,
});
const RENT = { charge: "monthly", amountMinor: 3_000_000, currency: "DZD" } as const;
const plan = (current: PlannedVersion[], change: Partial<CostChange>, today = "2026-11-20") =>
  planChange(current, { startsOn: current[0]!.validFrom, stopsOn: current[current.length - 1]!.validTo, money: RENT, ...change }, today);
const shape = (result: ReturnType<typeof planChange>) => (result.ok ? result.versions.map((v) => [v.id, v.validFrom, v.validTo, v.amountMinor, v.productId]) : result.reason);

describe("a change of a cost", () => {
  it("from a day ends the terms in force the day before and starts the new ones on it", () => {
    expect(shape(plan([version({})], { money: { ...RENT, amountMinor: 3_600_000 }, from: "2026-11-14" }))).toEqual([
      ["v1", "2026-09-01", "2026-11-13", 3_000_000, null],
      [null, "2026-11-14", null, 3_600_000, null],
    ]);
  });

  it("with no day, or from the day the terms in force started, corrects them in place", () => {
    const raised = [version({ validTo: "2026-11-13" }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000 })];
    const corrected = [
      ["v1", "2026-09-01", "2026-11-13", 3_000_000, null],
      ["v2", "2026-11-14", null, 3_500_000, null],
    ];
    expect(shape(plan(raised, { money: { ...RENT, amountMinor: 3_500_000 } }))).toEqual(corrected);
    expect(shape(plan(raised, { money: { ...RENT, amountMinor: 3_500_000 }, from: "2026-11-14" }))).toEqual(corrected);
  });

  it("from a day before the terms in force applies to every day from it, the earlier ones keep theirs", () => {
    const raised = [version({ validTo: "2026-11-13" }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000 })];
    expect(shape(plan(raised, { money: { ...RENT, amountMinor: 3_700_000 }, from: "2026-11-01" }))).toEqual([
      ["v1", "2026-09-01", "2026-10-31", 3_000_000, null],
      ["v2", "2026-11-01", null, 3_700_000, null],
    ]);
    expect(shape(plan(raised, { money: { ...RENT, amountMinor: 3_700_000 }, from: "2026-01-01" }))).toEqual([["v1", "2026-09-01", null, 3_700_000, null]]);
  });

  it("of what it is for, from a day, keeps each earlier day's product and each later day's amount", () => {
    const robe = { productId: "robe", productName: "Robe" };
    const raised = [version({ validTo: "2026-11-13", ...robe }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000, ...robe })];
    expect(shape(plan(raised, { money: { ...RENT, amountMinor: 3_600_000 }, target: { productId: "sac", productName: "Sac" }, from: "2026-11-01" }))).toEqual([
      ["v1", "2026-09-01", "2026-10-31", 3_000_000, "robe"],
      [null, "2026-11-01", "2026-11-13", 3_000_000, "sac"],
      ["v2", "2026-11-14", null, 3_600_000, "sac"],
    ]);
  });

  it("back to what it was before merges the two into one", () => {
    const raised = [version({ validTo: "2026-11-13" }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000 })];
    expect(shape(plan(raised, { money: RENT, from: "2026-11-14" }))).toEqual([["v1", "2026-09-01", null, 3_000_000, null]]);
  });

  it("is refused from a day after today, or after the cost stops", () => {
    expect(plan([version({})], { money: { ...RENT, amountMinor: 1 }, from: "2026-11-21" })).toEqual({ ok: false, reason: "dates" });
    expect(plan([version({ validTo: "2026-11-10" })], { money: { ...RENT, amountMinor: 1 }, from: "2026-11-11" })).toEqual({ ok: false, reason: "dates" });
    expect(plan([version({})], { money: RENT, from: "2026-12-25" }).ok).toBe(true);
  });

  it("is accepted from today, and from the cost's last day for that day alone", () => {
    expect(shape(plan([version({})], { money: { ...RENT, amountMinor: 1 }, from: "2026-11-20" }))).toEqual([
      ["v1", "2026-09-01", "2026-11-19", 3_000_000, null],
      [null, "2026-11-20", null, 1, null],
    ]);
    expect(shape(plan([version({ validTo: "2026-11-10" })], { money: { ...RENT, amountMinor: 1 }, from: "2026-11-10" }))).toEqual([
      ["v1", "2026-09-01", "2026-11-09", 3_000_000, null],
      [null, "2026-11-10", "2026-11-10", 1, null],
    ]);
  });

  it("of its currency alone is a change of what it costs", () => {
    const ads = version({ charge: "daily", amountMinor: 2_000 });
    const result = plan([ads], { money: { charge: "daily", amountMinor: 2_000, currency: "USD" }, from: "2026-11-14" });
    expect(result.ok && result.versions.map((v) => [v.id, v.validFrom, v.validTo, v.currency])).toEqual([
      ["v1", "2026-09-01", "2026-11-13", "DZD"],
      [null, "2026-11-14", null, "USD"],
    ]);
  });

  it("that sends back the product in force changes no earlier day's product", () => {
    const moved = [version({ validTo: "2026-11-13", productId: "robe", productName: "Robe" }), version({ id: "v2", validFrom: "2026-11-14", productId: "sac", productName: "Sac" })];
    expect(shape(plan(moved, { target: { productId: "sac", productName: "Sac" }, from: "2026-11-01" }))).toEqual([
      ["v1", "2026-09-01", "2026-11-13", 3_000_000, "robe"],
      ["v2", "2026-11-14", null, 3_000_000, "sac"],
    ]);
  });

  it("of a one-time cost changes it whole, whatever the day, into a one-time cost or a repeating one", () => {
    const shoot = version({ charge: "once", validFrom: "2026-11-03", amountMinor: 2_500_000 });
    expect(shape(plan([shoot], { money: { ...RENT, charge: "once", amountMinor: 2_000_000 }, from: "2026-11-10" }))).toEqual([["v1", "2026-11-03", null, 2_000_000, null]]);
    const repeating = plan([shoot], { money: RENT, from: "2026-11-10" });
    expect(repeating.ok && repeating.versions.map((v) => [v.id, v.validFrom, v.validTo, v.charge, v.amountMinor])).toEqual([["v1", "2026-11-03", null, "monthly", 3_000_000]]);
  });

  it("to a one-time cost leaves it no last day, even when one is sent", () => {
    const result = plan([version({})], { money: { ...RENT, charge: "once" }, stopsOn: "2026-11-30" });
    expect(result.ok && result.versions.map((v) => [v.id, v.validFrom, v.validTo, v.charge])).toEqual([["v1", "2026-09-01", null, "once"]]);
  });

  it("is refused when a cost with earlier versions would become a one-time cost, or stop being one", () => {
    const raised = [version({ validTo: "2026-11-13" }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000 })];
    expect(plan(raised, { money: { ...RENT, charge: "once" }, stopsOn: null })).toEqual({ ok: false, reason: "has_history" });
    expect(plan([version({ charge: "once" })], { money: RENT }).ok).toBe(true);
  });
});

describe("moving a cost's first or last day", () => {
  const raised = [version({ validTo: "2026-11-13" }), version({ id: "v2", validFrom: "2026-11-14", amountMinor: 3_600_000 })];

  it("stopping it before a later version drops that version", () => {
    expect(shape(plan(raised, { stopsOn: "2026-11-05", money: { ...RENT, amountMinor: 3_600_000 } }))).toEqual([["v1", "2026-09-01", "2026-11-05", 3_000_000, null]]);
  });

  it("stopping it on a later version's first day keeps that day at that version's amount", () => {
    expect(shape(plan(raised, { stopsOn: "2026-11-14", money: { ...RENT, amountMinor: 3_600_000 } }))).toEqual([
      ["v1", "2026-09-01", "2026-11-13", 3_000_000, null],
      ["v2", "2026-11-14", "2026-11-14", 3_600_000, null],
    ]);
  });

  it("starting it on an earlier version's last day keeps that day at that version's amount", () => {
    expect(shape(plan(raised, { startsOn: "2026-11-13", money: { ...RENT, amountMinor: 3_600_000 } }))).toEqual([
      ["v1", "2026-11-13", "2026-11-13", 3_000_000, null],
      ["v2", "2026-11-14", null, 3_600_000, null],
    ]);
  });

  it("keeps each day's terms: days added before take the first, days added after the last", () => {
    expect(shape(plan(raised, { startsOn: "2026-08-01", money: { ...RENT, amountMinor: 3_600_000 } }))).toEqual([
      ["v1", "2026-08-01", "2026-11-13", 3_000_000, null],
      ["v2", "2026-11-14", null, 3_600_000, null],
    ]);
    expect(shape(plan(raised, { startsOn: "2026-11-20", money: { ...RENT, amountMinor: 3_600_000 } }))).toEqual([["v2", "2026-11-20", null, 3_600_000, null]]);
  });
});

describe("any change of any cost", () => {
  const moneyArb = fc.record({
    charge: fc.constantFrom("daily", "monthly", "per_delivered" as const),
    amountMinor: fc.constantFrom(10_000, 20_000, 30_000),
    currency: fc.constantFrom("DZD", "USD" as const),
  });
  const productArb = fc.constantFrom(null, "p1", "p2");
  const seriesArb = fc
    .record({
      start: fc.integer({ min: 0, max: 60 }),
      parts: fc.array(fc.record({ length: fc.integer({ min: 1, max: 30 }), money: moneyArb, productId: productArb }), { minLength: 1, maxLength: 4 }),
      open: fc.boolean(),
      once: fc.boolean(),
    })
    .map(({ start, parts, open, once }): PlannedVersion[] => {
      if (once) return [{ id: "v0", validFrom: on(start), validTo: null, ...parts[0]!.money, charge: "once", productId: parts[0]!.productId, productName: parts[0]!.productId }];
      let from = on(start);
      return parts.map((part, index) => {
        const validTo = index === parts.length - 1 && open ? null : addDays(from, part.length - 1);
        const made: PlannedVersion = { id: `v${index}`, validFrom: from, validTo, ...part.money, productId: part.productId, productName: part.productId };
        if (validTo) from = addDays(validTo, 1);
        return made;
      });
    });
  const changeArb = fc
    .record({
      start: fc.integer({ min: 0, max: 150 }),
      length: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
      money: fc.oneof(moneyArb, moneyArb.map((money) => ({ ...money, charge: "once" as const }))),
      target: fc.option(fc.constantFrom(null, "p1", "p3"), { nil: undefined }),
      from: fc.option(fc.integer({ min: -10, max: 200 }), { nil: null }),
      today: fc.integer({ min: 0, max: 200 }),
    })
    .map(({ start, length, money, target, from, today }) => ({
      change: {
        startsOn: on(start),
        stopsOn: length === null ? null : on(start + length),
        money,
        target: target === undefined ? undefined : { productId: target, productName: target },
        from: from === null ? null : on(from),
      } satisfies CostChange,
      today: on(today),
    }));

  type Terms = Pick<PlannedVersion, "charge" | "amountMinor" | "currency" | "productId">;
  const terms = (v: Terms): Terms => ({ charge: v.charge, amountMinor: v.amountMinor, currency: v.currency, productId: v.productId });
  const termsOn = (versions: readonly PlannedVersion[], day: string) => {
    const found = versions.find((v) => v.validFrom <= day && (v.validTo === null || day <= v.validTo));
    return found ? terms(found) : null;
  };
  const sameMoney = (a: CostMoney, b: CostMoney) => a.charge === b.charge && a.amountMinor === b.amountMinor && a.currency === b.currency;

  it("gives every day of the cost the terms it asks, keeps every day before its day, and nothing outside the cost's days", () => {
    fc.assert(
      fc.property(seriesArb, changeArb, (current, { change, today }) => {
        const result = planChange(current, change, today);
        const latest = current[current.length - 1]!;
        if (current.length > 1 && (change.money.charge === "once") !== (latest.charge === "once")) return void expect(result).toEqual({ ok: false, reason: "has_history" });

        const stopsOn = change.money.charge === "once" ? null : change.stopsOn;
        const moneyChanged = !sameMoney(change.money, latest);
        const targetChanged = change.target !== undefined && change.target.productId !== latest.productId;
        let from: string | null = null;
        if (moneyChanged || targetChanged) {
          if (change.from !== null && change.from > today) return void expect(result).toEqual({ ok: false, reason: "dates" });
          const asked = change.money.charge === "once" || latest.charge === "once" ? change.startsOn : (change.from ?? latest.validFrom);
          from = asked > change.startsOn ? asked : change.startsOn;
          if (stopsOn !== null && from > stopsOn) return void expect(result).toEqual({ ok: false, reason: "dates" });
        }
        if (!result.ok) throw new Error(`refused: ${result.reason}`);
        const versions = result.versions;

        expect(versions[0]!.validFrom).toBe(change.startsOn);
        expect(versions[versions.length - 1]!.validTo).toBe(stopsOn);
        versions.forEach((v, i) => {
          if (v.validTo !== null) expect(v.validTo >= v.validFrom).toBe(true);
          if (i === 0) return;
          expect(v.validFrom).toBe(addDays(versions[i - 1]!.validTo!, 1));
          expect(terms(v)).not.toEqual(terms(versions[i - 1]!));
        });
        const ids = versions.flatMap((v) => (v.id === null ? [] : [v.id]));
        expect(versions[0]!.id).not.toBeNull();
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(current.some((v) => v.id === id)).toBe(true);
        if (versions.some((v) => v.charge === "once")) expect(versions).toHaveLength(1);

        const first = current[0]!;
        for (let n = -20; n <= 300; n++) {
          const day = on(n);
          const inside = day >= change.startsOn && (stopsOn === null || day <= stopsOn);
          let expected: Terms | null = null;
          if (inside) {
            const was = day < first.validFrom ? terms(first) : latest.validTo !== null && day > latest.validTo ? terms(latest) : termsOn(current, day);
            expected = from !== null && day >= from ? { ...was!, ...(moneyChanged ? change.money : {}), ...(targetChanged ? { productId: change.target!.productId } : {}) } : was;
          }
          expect(termsOn(versions, day), day).toEqual(expected);
        }

        const saved = versions.map((v, i) => ({ ...v, id: v.id ?? `new${i}` }));
        const last = saved[saved.length - 1]!;
        const untouched = planChange(saved, { startsOn: saved[0]!.validFrom, stopsOn: last.validTo, money: { charge: last.charge, amountMinor: last.amountMinor, currency: last.currency }, from: change.from }, today);
        expect(untouched).toEqual({ ok: true, versions: saved });
      }),
      { numRuns: 1_000 },
    );
  });
});
