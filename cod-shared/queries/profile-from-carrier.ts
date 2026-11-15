/**
 * Copying a delivery company's rates into a shipping profile (ADR 0024): a
 * preview of every wilaya's price before and after, then the copy itself,
 * written in one batch. The copy is made when the merchant asks and never
 * again on its own.
 */
import { count, eq } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { carrierPlaces, deliveryCompanies, shippingProfiles, shippingRuleCommunes, shippingRules } from "../db/schema";
import { profileFromRates, type CarrierPricing, type ProfileFromRates } from "../carriers/profile-from-rates";
import { writeProfileRules } from "./shipping-profiles";

/** A wilaya's prices in a profile: its rule, and how many communes have their own. */
export interface WilayaPrices {
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
  /** Communes with a price or a switch of their own. */
  communes: number;
}

export interface CarrierCopyPreview {
  company: { id: string; name: string; nameAr: string; placesSyncedAt: string | null };
  /** Every wilaya the profile has now or will have, in order: null where it has none. */
  wilayas: Array<{ wilayaId: number; before: WilayaPrices | null; after: WilayaPrices | null }>;
}

export type CarrierCopyPlan =
  | { kind: "profile-not-found" }
  | { kind: "company-not-found" }
  | { kind: "places-not-read"; company: CarrierCopyPreview["company"] }
  | { kind: "no-rates"; company: CarrierCopyPreview["company"] }
  | { kind: "ready"; preview: CarrierCopyPreview; plan: ProfileFromRates };

/** What copying the company's rates into the profile would do, at the merchant's pricing. */
export async function planCarrierCopy(db: AppDb, profileId: string, companyId: string, pricing: CarrierPricing): Promise<CarrierCopyPlan> {
  const [profile, company, places, rules, overrides] = await db.batch([
    db.select({ id: shippingProfiles.id }).from(shippingProfiles).where(eq(shippingProfiles.id, profileId)),
    db.select({ id: deliveryCompanies.id, name: deliveryCompanies.name, nameAr: deliveryCompanies.nameAr, placesSyncedAt: deliveryCompanies.placesSyncedAt }).from(deliveryCompanies).where(eq(deliveryCompanies.id, companyId)),
    db.select({ communeId: carrierPlaces.communeId, home: carrierPlaces.home, homeRate: carrierPlaces.homeRate, stopDeskRate: carrierPlaces.stopDeskRate }).from(carrierPlaces).where(eq(carrierPlaces.companyId, companyId)),
    db.select({ id: shippingRules.id, wilayaId: shippingRules.wilayaId, homePrice: shippingRules.homePrice, stopDeskPrice: shippingRules.stopDeskPrice, homeEnabled: shippingRules.homeEnabled, stopDeskEnabled: shippingRules.stopDeskEnabled }).from(shippingRules).where(eq(shippingRules.profileId, profileId)),
    db.select({ ruleId: shippingRuleCommunes.ruleId, n: count() }).from(shippingRuleCommunes).innerJoin(shippingRules, eq(shippingRules.id, shippingRuleCommunes.ruleId)).where(eq(shippingRules.profileId, profileId)).groupBy(shippingRuleCommunes.ruleId),
  ]);
  if (!profile[0]) return { kind: "profile-not-found" };
  const found = company[0];
  if (!found) return { kind: "company-not-found" };
  if (!found.placesSyncedAt || places.length === 0) return { kind: "places-not-read", company: found };

  const plan = profileFromRates(places, pricing);
  if (plan.rules.length === 0) return { kind: "no-rates", company: found };

  const overridesOf = new Map(overrides.map((row) => [row.ruleId, row.n]));
  const before = new Map(rules.map((rule) => [rule.wilayaId, { homePrice: rule.homePrice, stopDeskPrice: rule.stopDeskPrice, homeEnabled: rule.homeEnabled, stopDeskEnabled: rule.stopDeskEnabled, communes: overridesOf.get(rule.id) ?? 0 }]));
  const after = new Map(plan.rules.map((rule) => [rule.wilayaId, { ...rule, communes: plan.communes.get(rule.wilayaId)?.length ?? 0 }]));
  const wilayaIds = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  const wilayas = wilayaIds.map((wilayaId) => {
    const next = after.get(wilayaId);
    return { wilayaId, before: before.get(wilayaId) ?? null, after: next ? { homePrice: next.homePrice, stopDeskPrice: next.stopDeskPrice, homeEnabled: next.homeEnabled, stopDeskEnabled: next.stopDeskEnabled, communes: next.communes } : null };
  });
  return { kind: "ready", preview: { company: found, wilayas }, plan };
}

/** Copy the company's rates into the profile: the plan, written in one batch. Answers what was planned. */
export async function copyCarrierRates(db: AppDb, profileId: string, companyId: string, pricing: CarrierPricing): Promise<CarrierCopyPlan> {
  const planned = await planCarrierCopy(db, profileId, companyId, pricing);
  if (planned.kind === "ready") await writeProfileRules(db, profileId, planned.plan.rules, planned.plan.communes);
  return planned;
}
