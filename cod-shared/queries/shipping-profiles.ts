/**
 * Shipping Profiles Queries
 *
 * Profiles define what the CUSTOMER pays. They are referenced only by
 * products (products.shippingProfileId). Drivers and delivery companies
 * have no relationship to these profiles.
 *
 * updateProfile and setProfileRules stay in cod-server — they raise
 * BusinessLogicError / ValidationError — and write through `writeProfileRules`.
 */

import { eq, and, inArray } from "drizzle-orm";
import {
  shippingProfiles,
  shippingRules,
  shippingRuleCommunes,
  communes,
  wilayas,
  products,
} from "../db/schema";
import type { AppDb } from "../db/client";

export interface CreateProfileData {
  name: string;
  isDefault?: boolean;
  notes?: string | null;
}

export interface CommuneOverrideData {
  homeEnabled?: boolean | null;
  stopDeskEnabled?: boolean | null;
  homePrice?: number | null;
  stopDeskPrice?: number | null;
}

export interface ShippingRule {
  id: string;
  profileId: string;
  wilayaId: number;
  wilayaName: string;
  wilayaNameAr: string;
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
  createdAt: string;
}

export interface ShippingProfile {
  id: string;
  name: string;
  isDefault: boolean;
  notes: string | null;
  ruleCount: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingProfileWithRules extends Omit<ShippingProfile, "ruleCount"> {
  rules: ShippingRule[];
}

export interface CommuneWithOverride {
  communeId: string;
  communeName: string;
  communeNameAr: string;
  homeEnabled: boolean | null;
  stopDeskEnabled: boolean | null;
  homePrice: number | null;
  stopDeskPrice: number | null;
  effectiveHomeEnabled: boolean;
  effectiveStopDeskEnabled: boolean;
  effectiveHomePrice: number;
  effectiveStopDeskPrice: number;
  hasOverride: boolean;
}

export function newProfileId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function now() {
  return new Date().toISOString();
}

export async function getAllProfiles(db: AppDb): Promise<ShippingProfile[]> {
  const profiles = await db.select().from(shippingProfiles).all();
  const results = await Promise.all(
    profiles.map(async (p) => {
      const [rules, productRows] = await Promise.all([
        db
          .select({ id: shippingRules.id })
          .from(shippingRules)
          .where(eq(shippingRules.profileId, p.id))
          .all(),
        db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.shippingProfileId, p.id))
          .all(),
      ]);
      return {
        id: p.id,
        name: p.name,
        isDefault: Boolean(p.isDefault),
        notes: p.notes,
        ruleCount: rules.length,
        productCount: productRows.length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    }),
  );
  return results;
}

export async function getProfileById(
  db: AppDb,
  id: string,
): Promise<ShippingProfileWithRules | null> {
  const profile = await db
    .select()
    .from(shippingProfiles)
    .where(eq(shippingProfiles.id, id))
    .get();

  if (!profile) return null;

  const [rules, productRows] = await Promise.all([
    db
      .select({
        id: shippingRules.id,
        profileId: shippingRules.profileId,
        wilayaId: shippingRules.wilayaId,
        wilayaName: wilayas.name,
        wilayaNameAr: wilayas.nameAr,
        homePrice: shippingRules.homePrice,
        stopDeskPrice: shippingRules.stopDeskPrice,
        homeEnabled: shippingRules.homeEnabled,
        stopDeskEnabled: shippingRules.stopDeskEnabled,
        createdAt: shippingRules.createdAt,
      })
      .from(shippingRules)
      .leftJoin(wilayas, eq(shippingRules.wilayaId, wilayas.id))
      .where(eq(shippingRules.profileId, id))
      .all(),
    db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.shippingProfileId, id))
      .all(),
  ]);

  return {
    id: profile.id,
    name: profile.name,
    isDefault: Boolean(profile.isDefault),
    notes: profile.notes,
    productCount: productRows.length,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    rules: rules.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      wilayaId: r.wilayaId,
      wilayaName: r.wilayaName ?? String(r.wilayaId),
      wilayaNameAr: r.wilayaNameAr ?? String(r.wilayaId),
      homePrice: r.homePrice,
      stopDeskPrice: r.stopDeskPrice,
      homeEnabled: Boolean(r.homeEnabled ?? true),
      stopDeskEnabled: Boolean(r.stopDeskEnabled ?? false),
      createdAt: r.createdAt,
    })),
  };
}

export async function getDefaultProfileRules(db: AppDb): Promise<ShippingRule[]> {
  const defaultProfile = await db
    .select()
    .from(shippingProfiles)
    .where(eq(shippingProfiles.isDefault, true))
    .get();

  if (!defaultProfile) return [];

  const rules = await db
    .select({
      id: shippingRules.id,
      profileId: shippingRules.profileId,
      wilayaId: shippingRules.wilayaId,
      wilayaName: wilayas.name,
      wilayaNameAr: wilayas.nameAr,
      homePrice: shippingRules.homePrice,
      stopDeskPrice: shippingRules.stopDeskPrice,
      homeEnabled: shippingRules.homeEnabled,
      stopDeskEnabled: shippingRules.stopDeskEnabled,
      createdAt: shippingRules.createdAt,
    })
    .from(shippingRules)
    .leftJoin(wilayas, eq(shippingRules.wilayaId, wilayas.id))
    .where(eq(shippingRules.profileId, defaultProfile.id))
    .all();

  return rules.map((r) => ({
    id: r.id,
    profileId: r.profileId,
    wilayaId: r.wilayaId,
    wilayaName: r.wilayaName ?? String(r.wilayaId),
    wilayaNameAr: r.wilayaNameAr ?? String(r.wilayaId),
    homePrice: r.homePrice,
    stopDeskPrice: r.stopDeskPrice,
    homeEnabled: Boolean(r.homeEnabled ?? true),
    stopDeskEnabled: Boolean(r.stopDeskEnabled ?? false),
    createdAt: r.createdAt,
  }));
}

export async function createProfile(
  db: AppDb,
  data: CreateProfileData,
): Promise<ShippingProfileWithRules> {
  const id = newProfileId();
  const ts = now();

  if (data.isDefault) {
    await db.update(shippingProfiles).set({ isDefault: false }).run();
  }

  await db
    .insert(shippingProfiles)
    .values({
      id,
      name: data.name,
      isDefault: data.isDefault ?? false,
      notes: data.notes ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  return {
    id,
    name: data.name,
    isDefault: data.isDefault ?? false,
    notes: data.notes ?? null,
    productCount: 0,
    rules: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function deleteProfile(db: AppDb, id: string): Promise<boolean> {
  const existing = await db
    .select()
    .from(shippingProfiles)
    .where(eq(shippingProfiles.id, id))
    .get();

  if (!existing) return false;

  await db.delete(shippingProfiles).where(eq(shippingProfiles.id, id)).run();
  return true;
}

// ─── Commune Override Queries ─────────────────────────────────────────────────

export async function getWilayaRule(
  db: AppDb,
  profileId: string,
  wilayaId: number,
) {
  return db
    .select()
    .from(shippingRules)
    .where(
      and(eq(shippingRules.profileId, profileId), eq(shippingRules.wilayaId, wilayaId)),
    )
    .get();
}

export async function getCommunesWithOverrides(
  db: AppDb,
  ruleId: string,
  wilayaId: number,
  wilayaRule: {
    homeEnabled: boolean;
    stopDeskEnabled: boolean;
    homePrice: number;
    stopDeskPrice: number;
  },
): Promise<CommuneWithOverride[]> {
  const communeRows = await db
    .select()
    .from(communes)
    .where(eq(communes.wilayaId, wilayaId))
    .orderBy(communes.nameAr)
    .all();

  const overrideRows = await db
    .select()
    .from(shippingRuleCommunes)
    .where(eq(shippingRuleCommunes.ruleId, ruleId))
    .all();

  const overrideMap = new Map(overrideRows.map((r) => [r.communeId, r]));

  return communeRows.map((commune) => {
    const override = overrideMap.get(commune.id);
    const homeEnabled = override ? override.homeEnabled ?? null : null;
    const stopDeskEnabled = override ? override.stopDeskEnabled ?? null : null;
    const homePrice = override ? override.homePrice ?? null : null;
    const stopDeskPrice = override ? override.stopDeskPrice ?? null : null;

    return {
      communeId: commune.id,
      communeName: commune.name,
      communeNameAr: commune.nameAr,
      homeEnabled,
      stopDeskEnabled,
      homePrice,
      stopDeskPrice,
      effectiveHomeEnabled: homeEnabled ?? wilayaRule.homeEnabled,
      effectiveStopDeskEnabled: stopDeskEnabled ?? wilayaRule.stopDeskEnabled,
      effectiveHomePrice: homePrice ?? wilayaRule.homePrice,
      effectiveStopDeskPrice: stopDeskPrice ?? wilayaRule.stopDeskPrice,
      hasOverride: !!override,
    };
  });
}

export async function setCommuneOverride(
  db: AppDb,
  ruleId: string,
  communeId: string,
  data: CommuneOverrideData,
): Promise<void> {
  const homeEnabled = data.homeEnabled ?? null;
  const stopDeskEnabled = data.stopDeskEnabled ?? null;
  const homePrice = data.homePrice ?? null;
  const stopDeskPrice = data.stopDeskPrice ?? null;

  if (
    homeEnabled === null &&
    stopDeskEnabled === null &&
    homePrice === null &&
    stopDeskPrice === null
  ) {
    await db
      .delete(shippingRuleCommunes)
      .where(
        and(
          eq(shippingRuleCommunes.ruleId, ruleId),
          eq(shippingRuleCommunes.communeId, communeId),
        ),
      )
      .run();
    return;
  }

  const existing = await db
    .select({ id: shippingRuleCommunes.id })
    .from(shippingRuleCommunes)
    .where(
      and(
        eq(shippingRuleCommunes.ruleId, ruleId),
        eq(shippingRuleCommunes.communeId, communeId),
      ),
    )
    .get();

  if (existing) {
    await db
      .update(shippingRuleCommunes)
      .set({ homeEnabled, stopDeskEnabled, homePrice, stopDeskPrice })
      .where(eq(shippingRuleCommunes.id, existing.id))
      .run();
  } else {
    await db
      .insert(shippingRuleCommunes)
      .values({
        id: newProfileId(),
        ruleId,
        communeId,
        homeEnabled,
        stopDeskEnabled,
        homePrice,
        stopDeskPrice,
      })
      .run();
  }
}

export async function deleteCommuneOverride(
  db: AppDb,
  ruleId: string,
  communeId: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: shippingRuleCommunes.id })
    .from(shippingRuleCommunes)
    .where(
      and(
        eq(shippingRuleCommunes.ruleId, ruleId),
        eq(shippingRuleCommunes.communeId, communeId),
      ),
    )
    .get();

  if (!existing) return false;

  await db
    .delete(shippingRuleCommunes)
    .where(eq(shippingRuleCommunes.id, existing.id))
    .run();

  return true;
}

// ─── Writing a profile's rules ───────────────────────────────────────────────

/** One wilaya's rule as it is written. */
export interface ProfileRuleInput {
  wilayaId: number;
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
}

/** One commune's override as it is written; a null field inherits the wilaya rule. */
export interface ProfileCommuneInput {
  communeId: string;
  homePrice: number | null;
  stopDeskPrice: number | null;
  homeEnabled: boolean | null;
  stopDeskEnabled: boolean | null;
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Rows per INSERT, under D1's 100 bound parameters: eight columns a rule, seven an override. */
const RULES_PER_INSERT = 12;
const OVERRIDES_PER_INSERT = 14;

/**
 * Make a profile's rules exactly `rules`, in one batch (a D1 batch is one
 * transaction, and one query against the Free plan's 50 per request).
 *
 * A wilaya that stays keeps its rule, and so its Commune Overrides: only its
 * prices and switches change. A wilaya that goes takes its overrides with it.
 * `communes`, when it names a wilaya, replaces that wilaya's overrides with
 * the ones given (an empty list clears them); a wilaya it does not name keeps
 * the overrides it has.
 */
export async function writeProfileRules(
  db: AppDb,
  profileId: string,
  rules: readonly ProfileRuleInput[],
  communes: ReadonlyMap<number, readonly ProfileCommuneInput[]> = new Map(),
  at: string = now(),
): Promise<void> {
  const current = await db
    .select({ id: shippingRules.id, wilayaId: shippingRules.wilayaId })
    .from(shippingRules)
    .where(eq(shippingRules.profileId, profileId))
    .all();
  const ruleOf = new Map(current.map((rule) => [rule.wilayaId, rule.id]));
  const kept = new Set(rules.map((rule) => rule.wilayaId));

  const statements: BatchStatement[] = [];
  const gone = current.filter((rule) => !kept.has(rule.wilayaId)).map((rule) => rule.id);
  for (let i = 0; i < gone.length; i += 90) statements.push(db.delete(shippingRules).where(inArray(shippingRules.id, gone.slice(i, i + 90))));

  const added: (typeof shippingRules.$inferInsert)[] = [];
  const idOf = new Map<number, string>();
  for (const rule of rules) {
    const values = { homePrice: rule.homePrice, stopDeskPrice: rule.stopDeskPrice, homeEnabled: rule.homeEnabled, stopDeskEnabled: rule.stopDeskEnabled };
    const id = ruleOf.get(rule.wilayaId);
    if (id) {
      statements.push(db.update(shippingRules).set(values).where(eq(shippingRules.id, id)));
      idOf.set(rule.wilayaId, id);
    } else {
      const newId = newProfileId();
      added.push({ id: newId, profileId, wilayaId: rule.wilayaId, ...values, createdAt: at });
      idOf.set(rule.wilayaId, newId);
    }
  }
  for (let i = 0; i < added.length; i += RULES_PER_INSERT) statements.push(db.insert(shippingRules).values(added.slice(i, i + RULES_PER_INSERT)));

  const overrides: (typeof shippingRuleCommunes.$inferInsert)[] = [];
  for (const [wilayaId, list] of communes) {
    const ruleId = idOf.get(wilayaId);
    if (!ruleId) continue;
    if (ruleOf.has(wilayaId)) statements.push(db.delete(shippingRuleCommunes).where(eq(shippingRuleCommunes.ruleId, ruleId)));
    for (const commune of list) overrides.push({ id: newProfileId(), ruleId, ...commune });
  }
  for (let i = 0; i < overrides.length; i += OVERRIDES_PER_INSERT) statements.push(db.insert(shippingRuleCommunes).values(overrides.slice(i, i + OVERRIDES_PER_INSERT)));

  statements.push(db.update(shippingProfiles).set({ updatedAt: at }).where(eq(shippingProfiles.id, profileId)));
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}
