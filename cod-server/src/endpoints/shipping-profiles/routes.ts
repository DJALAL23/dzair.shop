/**
 * Shipping Profiles Routes
 *
 * Profile CRUD, bulk wilaya-rule replacement, commune-level overrides, and
 * the default-profile auto-fill endpoint. All routes require an API key with
 * the appropriate delivery scope.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as handlers from "./handlers";
import {
  ShippingProfileSchema,
  ShippingProfileWithRulesSchema,
  ShippingRuleSchema,
  CommuneOverrideSchema,
  SuccessResponseSchema,
  ListResponseSchema,
} from "@/openapi/schemas";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";
import { CARRIER_PRICING_MAX_ADD } from "../../../../cod-shared/carriers/profile-from-rates";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── Params ───────────────────────────────────────────────────────────────────

const idParams = z.object({
  id: z.string().openapi({ description: "Shipping profile ID", example: "profile_123" }),
});

const ruleParams = z.object({
  ...idParams.shape,
  wilayaId: z.coerce.number().int().min(1).max(LAST_WILAYA_ID).openapi({
    description: `Wilaya ID (1–${LAST_WILAYA_ID})`,
    example: 16,
  }),
});

const communeParams = z.object({
  ...ruleParams.shape,
  communeId: z.string().openapi({ description: "Commune ID", example: "c-16-001" }),
});

// ─── Request schemas ──────────────────────────────────────────────────────────

const createBodySchema = z.object({
  name: z.string().min(1, "Name is required").openapi({ example: "Standard Rates" }),
  isDefault: z.boolean().default(false).optional(),
  notes: z.string().nullable().optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  isDefault: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const setRulesBodySchema = z.object({
  rules: z.array(
    z.object({
      wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID),
      homePrice: z.number().min(0).default(0),
      stopDeskPrice: z.number().min(0).default(0),
      homeEnabled: z.boolean().default(true).optional(),
      stopDeskEnabled: z.boolean().default(false).optional(),
    })
  ),
});

const communeOverrideBodySchema = z.object({
  homeEnabled: z.boolean().nullable().optional(),
  stopDeskEnabled: z.boolean().nullable().optional(),
  homePrice: z.number().min(0).nullable().optional(),
  stopDeskPrice: z.number().min(0).nullable().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const listProfilesRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Shipping Profiles"],
  summary: "List shipping profiles",
  description:
    "Returns all shipping rate profiles with `ruleCount` (number of wilaya rules) and `productCount` (how many products override the store default with this profile).",
  operationId: "listShippingProfiles",
  responses: {
    200: {
      description: "List of shipping profiles",
      content: jsonContent(ListResponseSchema(ShippingProfileSchema)),
    },
  },
  handler: handlers.listProfiles,
});

const createProfileRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Create shipping profile",
  description:
    "Creates a profile (rate-card metadata only). Use `PUT /{id}/rules` afterwards to populate wilaya rates. Setting `isDefault: true` atomically unsets the current default profile.",
  operationId: "createShippingProfile",
  body: createBodySchema,
  responses: {
    201: {
      description: "Profile created",
      content: jsonContent(SuccessResponseSchema(ShippingProfileWithRulesSchema)),
    },
  },
  handler: handlers.createProfile,
});

const getDefaultRulesRoute = defineRoute({
  method: "get",
  path: "/default/rules",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Shipping Profiles"],
  summary: "Get default-profile rules",
  description:
    "Returns the wilaya rules of the currently-active default profile. Used by the order form to auto-fill `deliveryFee`. Returns an empty array if no profile is marked default.",
  operationId: "getDefaultRules",
  responses: {
    200: {
      description: "Default profile rules (empty array if no default configured)",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.array(ShippingRuleSchema),
        })
      ),
    },
  },
  handler: handlers.getDefaultRules,
});

const getProfileRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Shipping Profiles"],
  summary: "Get shipping profile",
  description:
    "Returns a single profile with its full list of wilaya rules (including `homeEnabled` / `stopDeskEnabled`).",
  operationId: "getShippingProfile",
  params: idParams,
  responses: {
    200: {
      description: "Profile with rules",
      content: jsonContent(SuccessResponseSchema(ShippingProfileWithRulesSchema)),
    },
  },
  handler: handlers.getProfile,
});

const updateProfileRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Update shipping profile",
  description:
    "Partial update of profile metadata. Include only the fields you want to change. Set `notes` to `null` to clear it.\n\n" +
    "**Default invariant:** the system always keeps exactly one profile marked `isDefault`. Setting `isDefault: true` here atomically unsets the current default. Setting `isDefault: false` on the **only** default profile is rejected with `422 DEFAULT_PROFILE_REQUIRED`.",
  operationId: "updateShippingProfile",
  params: idParams,
  body: updateBodySchema,
  responses: {
    200: {
      description: "Profile updated",
      content: jsonContent(SuccessResponseSchema(ShippingProfileWithRulesSchema)),
    },
    422: {
      description:
        "Cannot unset the last default profile — one profile must always be default (code: DEFAULT_PROFILE_REQUIRED)",
    },
  },
  handler: handlers.updateProfile,
});

const deleteProfileRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Delete shipping profile",
  description:
    "Permanently deletes a profile and all of its wilaya rules (commune overrides cascade).\n\n" +
    "**Blocked when:**\n" +
    "- The profile is currently referenced by one or more products → `422 PROFILE_IN_USE`\n" +
    "- The profile is the default profile → `422 DEFAULT_PROFILE_REQUIRED` (set another profile as default first)",
  operationId: "deleteShippingProfile",
  params: idParams,
  responses: {
    200: {
      description: "Profile deleted",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })),
    },
    422: {
      description:
        "Profile cannot be deleted — disambiguate via `code`: PROFILE_IN_USE or DEFAULT_PROFILE_REQUIRED",
    },
  },
  handler: handlers.deleteProfile,
});

const setProfileRulesRoute = defineRoute({
  method: "put",
  path: "/{id}/rules",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Replace wilaya rules",
  description:
    "Sets the profile's rules to exactly this list, in one transaction. A wilaya that stays keeps its commune overrides (only its prices and switches change); a wilaya left out is removed with its overrides.\n\n" +
    "**Constraints:**\n" +
    "- Each `wilayaId` may appear **at most once** per profile. Duplicates are rejected with `DUPLICATE_WILAYA_RULE`.\n" +
    "- Setting both `homeEnabled: false` and `stopDeskEnabled: false` on a wilaya effectively disables delivery for that wilaya under this profile.\n" +
    "- Sending an empty `rules` array clears all rules for the profile.",
  operationId: "setProfileRules",
  params: idParams,
  body: setRulesBodySchema,
  responses: {
    200: {
      description: "Rules replaced — returns the profile with its new rules",
      content: jsonContent(SuccessResponseSchema(ShippingProfileWithRulesSchema)),
    },
    400: {
      description:
        "Validation error, including duplicate wilayaId in rules array (code: DUPLICATE_WILAYA_RULE)",
    },
  },
  handler: handlers.setProfileRules,
});

const listCommuneOverridesRoute = defineRoute({
  method: "get",
  path: "/{id}/rules/{wilayaId}/communes",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Shipping Profiles"],
  summary: "List commune overrides",
  description:
    "Returns every commune in a wilaya with its override status. For each commune the response includes:\n\n" +
    "- **Raw override fields** (`homeEnabled`, `stopDeskEnabled`, `homePrice`, `stopDeskPrice`) — `null` means that field inherits from the wilaya rule.\n" +
    "- **Effective values** (`effectiveHome*`, `effectiveStopDesk*`) — the actual values used during fee resolution (commune override merged onto the wilaya defaults).\n" +
    "- **hasOverride** — `true` if any override row exists for this commune.\n\n" +
    "Requires that the profile already has a rule for the given wilaya — otherwise responds `404 SHIPPING_RULE_NOT_FOUND`.",
  operationId: "listCommuneOverrides",
  params: ruleParams,
  responses: {
    200: {
      description: "All communes in this wilaya with override status",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.array(CommuneOverrideSchema),
        })
      ),
    },
  },
  handler: handlers.listCommuneOverrides,
});

const setCommuneOverrideRoute = defineRoute({
  method: "put",
  path: "/{id}/rules/{wilayaId}/communes/{communeId}",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Set or update commune override",
  description:
    "Upserts a commune-level override on top of the wilaya rule.\n\n" +
    "**Semantics:**\n" +
    "- Any field set to `null` (or omitted — which is treated as null) **inherits** from the wilaya rule at fee-resolution time.\n" +
    "- If **all four** override fields (`homeEnabled`, `stopDeskEnabled`, `homePrice`, `stopDeskPrice`) are null, the override row is deleted (equivalent to `DELETE`).\n" +
    "- Prices must be ≥ 0 when provided.\n\n" +
    "**Effects on orders:** subsequent online orders with this wilaya + commune pair will use the overridden values. Disabling `homeEnabled` or `stopDeskEnabled` causes `422 DELIVERY_NOT_AVAILABLE` at order creation for that mode.",
  operationId: "setCommuneOverride",
  params: communeParams,
  body: communeOverrideBodySchema,
  responses: {
    200: {
      description: "Override upserted (or removed if all fields null)",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })),
    },
  },
  handler: handlers.setCommuneOverride,
});

const deleteCommuneOverrideRoute = defineRoute({
  method: "delete",
  path: "/{id}/rules/{wilayaId}/communes/{communeId}",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Remove commune override",
  description:
    "Removes the commune override row — the commune will again inherit the wilaya rule. Returns `404 COMMUNE_OVERRIDE_NOT_FOUND` if no override row exists for this commune.",
  operationId: "deleteCommuneOverride",
  params: communeParams,
  responses: {
    200: {
      description: "Override removed — commune reverts to wilaya defaults",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })),
    },
  },
  handler: handlers.deleteCommuneOverride,
});

// ─── Copying a delivery company's rates ──────────────────────────────────────

const carrierCopyBodySchema = z.object({
  companyId: z.string().min(1).openapi({ description: "The delivery company whose rates are copied", example: "company_zr" }),
  add: z.number().int().min(0).max(CARRIER_PRICING_MAX_ADD).default(0).openapi({ description: "DZD added to every carrier price; 0 copies the carrier's price as it is", example: 100 }),
  roundTo: z.union([z.literal(0), z.literal(10), z.literal(50), z.literal(100)]).default(0).openapi({ description: "Each price is rounded up to a multiple of this; 0 does not round", example: 50 }),
});

const WilayaPricesSchema = z.object({
  homePrice: z.number(),
  stopDeskPrice: z.number(),
  homeEnabled: z.boolean(),
  stopDeskEnabled: z.boolean(),
  communes: z.number().int().openapi({ description: "Communes with a price or a switch of their own" }),
});

const CarrierCopyPreviewSchema = z
  .object({
    company: z.object({ id: z.string(), name: z.string(), nameAr: z.string(), placesSyncedAt: z.string().nullable().openapi({ description: "When the company's places and prices were last read from its API" }) }),
    wilayas: z.array(z.object({ wilayaId: z.number().int(), before: WilayaPricesSchema.nullable(), after: WilayaPricesSchema.nullable() })).openapi({ description: "Every wilaya the profile has now or would have, in order; null where it has none (after: null is a wilaya the profile would stop delivering to)" }),
  })
  .openapi("CarrierCopyPreview");

const carrierCopyDescription =
  "Builds the profile's prices from the delivery company's rates as its API last gave them (POST /delivery-companies/{id}/sync-places reads them again): " +
  "each wilaya takes the company's most common price there plus `add`, rounded up to `roundTo`; a commune priced otherwise gets its own price; " +
  "home delivery is off where the company does not reach the door; stop desk is on wherever it gives a stop-desk price; a wilaya it does not serve is removed. " +
  "The profile and the company never follow each other afterwards (ADR 0024). " +
  "Refused with CARRIER_PLACES_NOT_READ before the company's places are read, and CARRIER_RATES_MISSING when it gives no price.";

const previewCarrierCopyRoute = defineRoute({
  method: "post",
  path: "/{id}/carrier-rates/preview",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Preview copying a delivery company's rates",
  description: `${carrierCopyDescription} Writes nothing.`,
  params: idParams,
  body: carrierCopyBodySchema,
  responses: {
    200: { description: "Each wilaya's prices before and after", content: jsonContent(SuccessResponseSchema(CarrierCopyPreviewSchema)) },
    404: { description: "Profile or delivery company not found" },
    422: { description: "CARRIER_PLACES_NOT_READ or CARRIER_RATES_MISSING" },
  },
  handler: handlers.previewCarrierCopy,
});

const copyCarrierRatesRoute = defineRoute({
  method: "put",
  path: "/{id}/carrier-rates",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Profiles"],
  summary: "Copy a delivery company's rates into the profile",
  description: `${carrierCopyDescription} Replaces the profile's prices and commune prices in one transaction.`,
  params: idParams,
  body: carrierCopyBodySchema,
  responses: {
    200: { description: "The profile with its new rules", content: jsonContent(SuccessResponseSchema(ShippingProfileWithRulesSchema)) },
    404: { description: "Profile or delivery company not found" },
    422: { description: "CARRIER_PLACES_NOT_READ or CARRIER_RATES_MISSING" },
  },
  handler: handlers.copyCarrierRatesIntoProfile,
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new OpenAPIHono<AppContext>();

router.openapi(listProfilesRoute.route, listProfilesRoute.handler);
router.openapi(createProfileRoute.route, createProfileRoute.handler);
router.openapi(getDefaultRulesRoute.route, getDefaultRulesRoute.handler);
router.openapi(getProfileRoute.route, getProfileRoute.handler);
router.openapi(updateProfileRoute.route, updateProfileRoute.handler);
router.openapi(deleteProfileRoute.route, deleteProfileRoute.handler);
router.openapi(setProfileRulesRoute.route, setProfileRulesRoute.handler);
router.openapi(listCommuneOverridesRoute.route, listCommuneOverridesRoute.handler);
router.openapi(setCommuneOverrideRoute.route, setCommuneOverrideRoute.handler);
router.openapi(deleteCommuneOverrideRoute.route, deleteCommuneOverrideRoute.handler);
router.openapi(previewCarrierCopyRoute.route, previewCarrierCopyRoute.handler);
router.openapi(copyCarrierRatesRoute.route, copyCarrierRatesRoute.handler);

export default router;
