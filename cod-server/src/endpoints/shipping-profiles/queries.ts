/**
 * Shipping Profiles DB Queries
 *
 * Pure reads + simple writes live in cod-shared.
 * updateProfile and setProfileRules stay here — they raise
 * BusinessLogicError / ValidationError (server-only error classes).
 */

import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { shippingProfiles } from "@/db/schema";
import type { UpdateProfileInput, BulkRulesInput } from "./validation";
import { BusinessLogicError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import {
  getProfileById,
  writeProfileRules,
} from "../../../../cod-shared/queries/shipping-profiles";

export {
  getAllProfiles,
  getProfileById,
  getDefaultProfileRules,
  createProfile,
  deleteProfile,
  getWilayaRule,
  getCommunesWithOverrides,
  setCommuneOverride,
  deleteCommuneOverride,
} from "../../../../cod-shared/queries/shipping-profiles";

export type {
  ShippingRule,
  ShippingProfile,
  ShippingProfileWithRules,
  CommuneWithOverride,
} from "../../../../cod-shared/queries/shipping-profiles";

import type { ShippingProfileWithRules } from "../../../../cod-shared/queries/shipping-profiles";

function now() {
  return new Date().toISOString();
}

export async function updateProfile(
  db: AppDb,
  id: string,
  data: UpdateProfileInput,
): Promise<ShippingProfileWithRules | null> {
  const existing = await db
    .select()
    .from(shippingProfiles)
    .where(eq(shippingProfiles.id, id))
    .get();

  if (!existing) return null;

  // Reject unsetting isDefault on the only default profile — system must always
  // have exactly one default so order fee resolution has a fallback.
  if (data.isDefault === false && existing.isDefault) {
    const otherDefaults = await db
      .select({ id: shippingProfiles.id })
      .from(shippingProfiles)
      .where(eq(shippingProfiles.isDefault, true))
      .all();
    if (otherDefaults.length <= 1) {
      throw new BusinessLogicError(
        "Cannot unset the last default shipping profile",
        ERROR_CODES.DEFAULT_PROFILE_REQUIRED,
        { profileId: id, profileName: existing.name },
      );
    }
  }

  if (data.isDefault) {
    await db.update(shippingProfiles).set({ isDefault: false }).run();
  }

  await db
    .update(shippingProfiles)
    .set({
      name: data.name ?? existing.name,
      isDefault: data.isDefault !== undefined ? data.isDefault : existing.isDefault,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      updatedAt: now(),
    })
    .where(eq(shippingProfiles.id, id))
    .run();

  return getProfileById(db, id);
}

/**
 * Set a profile's rules to exactly the ones given, in one batch. A wilaya that
 * stays keeps its rule and its Commune Overrides; one that goes takes its
 * overrides with it.
 */
export async function setProfileRules(
  db: AppDb,
  profileId: string,
  data: BulkRulesInput,
): Promise<ShippingProfileWithRules | null> {
  const existing = await db
    .select({ id: shippingProfiles.id })
    .from(shippingProfiles)
    .where(eq(shippingProfiles.id, profileId))
    .get();

  if (!existing) return null;

  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const r of data.rules) {
    if (seen.has(r.wilayaId)) duplicates.push(r.wilayaId);
    seen.add(r.wilayaId);
  }
  if (duplicates.length > 0) {
    throw new ValidationError(
      "Each wilaya may appear at most once in the rules array",
      ERROR_CODES.DUPLICATE_WILAYA_RULE,
      { profileId, duplicateWilayaIds: Array.from(new Set(duplicates)) },
    );
  }

  await writeProfileRules(
    db,
    profileId,
    data.rules.map((rule) => ({
      wilayaId: rule.wilayaId,
      homePrice: rule.homePrice,
      stopDeskPrice: rule.stopDeskPrice,
      homeEnabled: rule.homeEnabled ?? true,
      stopDeskEnabled: rule.stopDeskEnabled ?? false,
    })),
  );

  return getProfileById(db, profileId);
}
