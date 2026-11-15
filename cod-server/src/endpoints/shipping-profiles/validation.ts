/**
 * Shipping Profiles Validation Schemas
 */

import { z } from "zod";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";
import { CARRIER_PRICING_MAX_ADD } from "../../../../cod-shared/carriers/profile-from-rates";

export const createProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  isDefault: z.boolean().optional().default(false),
  notes: z.string().optional().nullable(),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  isDefault: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

const ruleEntrySchema = z.object({
  wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID),
  homePrice: z.number().min(0).default(0),
  stopDeskPrice: z.number().min(0).default(0),
  homeEnabled: z.boolean().optional().default(true),
  stopDeskEnabled: z.boolean().optional().default(false),
});

/** Replace all rules for a profile in one bulk operation. */
export const bulkRulesSchema = z.object({
  rules: z.array(ruleEntrySchema),
});

/** Set or update a commune-level override for a wilaya rule. Any null field = inherit. */
export const communeOverrideSchema = z.object({
  homeEnabled: z.boolean().nullable().optional(),
  stopDeskEnabled: z.boolean().nullable().optional(),
  homePrice: z.number().min(0).nullable().optional(),
  stopDeskPrice: z.number().min(0).nullable().optional(),
});

/** Copying a delivery company's rates into this profile: which company, and how its prices become the customer's. */
export const carrierCopySchema = z.object({
  companyId: z.string().min(1),
  add: z.number().int().min(0).max(CARRIER_PRICING_MAX_ADD).default(0),
  roundTo: z.union([z.literal(0), z.literal(10), z.literal(50), z.literal(100)]).default(0),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type BulkRulesInput = z.infer<typeof bulkRulesSchema>;
export type CommuneOverrideInput = z.infer<typeof communeOverrideSchema>;
export type CarrierCopyInput = z.infer<typeof carrierCopySchema>;
