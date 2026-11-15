/**
 * How a change reshapes a cost's versions. A cost runs from its first day to
 * its last (or on); its versions follow on, each with its terms: what it
 * costs (charge, amount, currency) and what it is for (the whole store or
 * one product).
 *
 * A change applies from a day, today at the latest: from that day on, the
 * terms that changed take their new values and the others stay what they
 * were each day; the days before keep everything. With no day, it applies
 * from the day the terms in force started: a correction of them. A one-time
 * cost has one version and is changed whole. Moving the first or last day
 * keeps each day's terms: days added before take the first terms, days
 * added after the last ones. Versions that end up with the same terms side
 * by side become one.
 */
import { addDays } from "../time/store-day";
import type { CostCharge, Currency } from "./model";

/** What a cost costs. */
export interface CostMoney {
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
}

/** What a cost is for: a product, or the whole store (both null). */
export interface CostTarget {
  productId: string | null;
  productName: string | null;
}

export type CostTerms = CostMoney & CostTarget;

/** A version as planned; `id` is null for one still to be written. */
export interface PlannedVersion extends CostTerms {
  id: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface CostChange {
  startsOn: string;
  stopsOn: string | null;
  money: CostMoney;
  /** Left out, what it is for stays as it is. */
  target?: CostTarget;
  /** The day the change applies from; left out or null, the day the terms in force started. */
  from?: string | null;
}

export type VersionPlan = { ok: true; versions: PlannedVersion[] } | { ok: false; reason: "has_history" | "dates" };

const sameMoney = (a: CostMoney, b: CostMoney) => a.charge === b.charge && a.amountMinor === b.amountMinor && a.currency === b.currency;
const sameTerms = (a: CostTerms, b: CostTerms) => sameMoney(a, b) && a.productId === b.productId;

/**
 * The versions a cost has after `change`, from the versions it has now (in
 * order, following on). Refused when a cost with earlier versions would
 * become a one-time cost or stop being one, or when the change would apply
 * after today or after the cost stops.
 */
export function planChange(current: readonly PlannedVersion[], change: CostChange, today: string): VersionPlan {
  const latest = current[current.length - 1]!;
  if (current.length > 1 && (change.money.charge === "once") !== (latest.charge === "once")) return { ok: false, reason: "has_history" };
  const moneyChanged = !sameMoney(change.money, latest);
  const targetChanged = change.target !== undefined && change.target.productId !== latest.productId;
  const stopsOn = change.money.charge === "once" ? null : change.stopsOn;
  let versions = within(current, change.startsOn, stopsOn);

  if (moneyChanged || targetChanged) {
    if (change.from != null && change.from > today) return { ok: false, reason: "dates" };
    const from = change.money.charge === "once" || latest.charge === "once" ? change.startsOn : (change.from ?? latest.validFrom);
    if (stopsOn !== null && from > stopsOn) return { ok: false, reason: "dates" };
    versions = splitAt(versions, from).map((version) =>
      version.validFrom >= from ? { ...version, ...(moneyChanged ? change.money : {}), ...(targetChanged ? change.target : {}) } : version,
    );
  }
  return { ok: true, versions: merged(versions) };
}

/** The versions over `startsOn`…`stopsOn`: the first runs back to the start, the last on to the end. */
function within(current: readonly PlannedVersion[], startsOn: string, stopsOn: string | null): PlannedVersion[] {
  const last = current.length - 1;
  const kept = current.filter((version, index) => (index === last || version.validTo! >= startsOn) && (index === 0 || stopsOn === null || version.validFrom <= stopsOn));
  return kept.map((version, index) => ({
    ...version,
    ...(index === 0 ? { validFrom: startsOn } : {}),
    ...(index === kept.length - 1 ? { validTo: stopsOn } : {}),
  }));
}

/** The version running on `day`, cut so that a version starts on it. */
function splitAt(versions: PlannedVersion[], day: string): PlannedVersion[] {
  return versions.flatMap((version) =>
    version.validFrom < day && (version.validTo === null || version.validTo >= day) ? [{ ...version, validTo: addDays(day, -1) }, { ...version, id: null, validFrom: day }] : [version],
  );
}

/** Side-by-side versions with the same terms, as one. */
function merged(versions: PlannedVersion[]): PlannedVersion[] {
  const out: PlannedVersion[] = [];
  for (const version of versions) {
    const previous = out[out.length - 1];
    if (previous && sameTerms(previous, version)) out[out.length - 1] = { ...previous, id: previous.id ?? version.id, validTo: version.validTo };
    else out.push(version);
  }
  return out;
}
