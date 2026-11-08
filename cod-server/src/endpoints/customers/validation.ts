/**
 * Customers Validation Schemas
 * 
 * Zod schemas for customer management request validation.
 */

import { z } from "zod";
import { editedEmailField, newEmailField } from "@/lib/email-field";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";

export const createCustomerSchema = z.object({
  name: z.string().min(1, "Name is required").describe("The full name of the customer"),
  phone: z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number").describe("Primary Algerian phone number (e.g., 0555123456)"),
  phone2: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number").optional()
  ).describe("Secondary Algerian phone number (optional)"),
  email: newEmailField().describe("Email address (optional); stored lower-cased"),
  wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID).describe(`The numeric ID of the Algerian wilaya (1–${LAST_WILAYA_ID})`),
  communeId: z.string().min(1, "Commune is required").describe("The commune's text ID in \"c-XX-YYY\" format (e.g. \"c-16-001\")"),
  address: z.string().optional().describe("Full residential or business address (optional)"),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1, "Name is required").optional().describe("Updated full name of the customer"),
  phone: z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number").optional().describe("Updated primary Algerian phone number"),
  phone2: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number").nullable().optional()
  ).describe("Updated secondary Algerian phone number (can be null)"),
  email: editedEmailField().describe("Updated email address (null or empty clears it)"),
  wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID).optional().describe(`Updated numeric ID of the wilaya (1–${LAST_WILAYA_ID})`),
  communeId: z.string().min(1, "Commune is required").nullable().optional().describe("Updated ID of the commune (can be null to clear)"),
  address: z.string().optional().nullable().describe("Updated full address"),
});

export const customerFiltersSchema = z.object({
  wilayaId: z.coerce.number().int().min(1).max(LAST_WILAYA_ID).optional().describe(`Filter by Algerian wilaya ID (1–${LAST_WILAYA_ID})`),
  search: z.string().optional().describe("Search term for name, phone number or email"),
  groupId: z.string().optional().describe("Filter by customer group UUID"),
  tagId: z.string().optional().describe("Filter by customer tag UUID"),
  limit: z.coerce.number().int().positive().max(100).default(50).describe("Maximum number of results to return (max 100)"),
  offset: z.coerce.number().int().min(0).default(0).describe("Number of results to skip for pagination"),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerFiltersInput = z.infer<typeof customerFiltersSchema>;