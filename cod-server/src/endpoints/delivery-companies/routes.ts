/**
 * Delivery Companies Routes
 *
 * CRUD endpoints for third-party delivery company management.
 * Built with defineRoute() — the standard route-builder pattern.
 *
 * Each route declares its own scope: reading needs delivery:read; creating,
 * editing and deleting a company need delivery:create / update / delete;
 * anything that drives the carrier or its webhooks needs delivery:manage.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import * as handlers from "./handlers";
import * as webhookHandlers from "./webhook-handlers";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { CARRIER_PROVIDERS } from "../../../../cod-shared/carriers/providers";
import { INBOX_RESULTS } from "../../../../cod-shared/inbound/inbox";

/** Inbox results, and `unmapped` on rows the old handler wrote. */
const INBOX_RESULT_FILTERS = [...INBOX_RESULTS, "unmapped"] as const;
import {
  DeliveryCompanySchema,
  StopDeskSchema,
  SuccessResponseSchema,
  ListResponseSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const deliveryCompaniesRouter = new OpenAPIHono<AppContext>();

// ─── Params & request schemas ────────────────────────────────────────────────

const idParams = z.object({
  id: z.string().openapi({ description: "Delivery company ID", example: "comp_abc123" }),
});

const listQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional().openapi({
    description: "Filter by active status",
    example: "true",
  }),
  search: z.string().optional().openapi({
    description: "Search in company name (EN/AR) and code",
  }),
  limit: z.coerce.number().int().positive().max(100).default(50).openapi({
    description: "Maximum number of results",
    example: 50,
  }),
  offset: z.coerce.number().int().min(0).default(0).openapi({
    description: "Pagination offset",
    example: 0,
  }),
});

const createBodySchema = z.object({
  name: z.string().min(1).openapi({ example: "Yalidine" }),
  nameAr: z.string().min(1).openapi({ example: "ياليدين" }),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/)
    .openapi({ example: "yalidine", description: "Lowercase alphanumeric with underscores" }),
  website: z.string().url().optional().nullable().openapi({ example: "https://www.yalidine.com" }),
  active: z.boolean().default(true).openapi({ example: true }),
  apiEndpoint: z.string().url().optional().nullable().openapi({ example: "https://api.yalidine.app/v1" }),
  apiToken: z.string().optional().nullable().openapi({ description: "API authentication token" }),
  apiUserGuid: z.string().optional().nullable().openapi({ description: "Tenant/user GUID for ZR Express" }),
  supportsHomeDelivery: z.boolean().default(true),
  supportsStopDesk: z.boolean().default(true),
  supportsTracking: z.boolean().default(false),
  autoValidate: z.boolean().optional().openapi({
    description:
      "When true, orders are auto-validated on dispatch (locked at carrier). " +
      "When false, orders stay editable. If omitted, a safe default is derived per provider.",
  }),
  notes: z.string().optional().nullable(),
  provider: z.enum(CARRIER_PROVIDERS).optional().nullable().openapi({
    description: "Which carrier adapter serves this company. When omitted it is derived from the code.",
  }),
  providerConfig: z.record(z.string(), z.unknown()).optional().openapi({
    description: "The adapter's own settings (e.g. Yalidine: platform, fromWilayaName, proxyBaseUrl, proxySecret). Merged onto the stored settings; a secret sent back masked keeps the stored one; null removes a key.",
  }),
});

const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  website: z.string().url().optional().nullable(),
  active: z.boolean().optional(),
  apiEndpoint: z.string().url().optional().nullable(),
  apiToken: z.string().optional().nullable(),
  apiUserGuid: z.string().optional().nullable(),
  supportsHomeDelivery: z.boolean().optional(),
  supportsStopDesk: z.boolean().optional(),
  supportsTracking: z.boolean().optional(),
  autoValidate: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  provider: z.enum(CARRIER_PROVIDERS).optional().nullable().openapi({
    description: "Which carrier adapter serves this company. When omitted it is derived from the code.",
  }),
  providerConfig: z.record(z.string(), z.unknown()).optional().openapi({
    description: "The adapter's own settings (e.g. Yalidine: platform, fromWilayaName, proxyBaseUrl, proxySecret). Merged onto the stored settings; a secret sent back masked keeps the stored one; null removes a key.",
  }),
});

const stopDesksQuerySchema = z.object({
  wilayaId: z.coerce.number().int().optional().openapi({
    description: "Filter by wilaya ID",
    example: 16,
  }),
  activeOnly: z.enum(["true", "false"]).default("true").openapi({
    description: "Filter by active flag (default true)",
    example: "true",
  }),
});

const toggleParams = z.object({
  id: z.string().openapi({ description: "Delivery company ID", example: "comp_abc123" }),
  code: z.string().openapi({ description: "Stop desk code", example: "16A" }),
});

const saveSecretBodySchema = z.object({
  secret: z.string().min(1).openapi({ description: "Webhook secret key from Yalidine dashboard" }),
});

const saveMappingBodySchema = z.object({
  mapping: z.record(z.string(), z.array(z.string())).openapi({
    description:
      "Keys must be valid our-status strings (new, preparing, assigned, out_for_delivery, delivered, returned, cancelled). " +
      "Values are arrays of ZR state names.",
    example: {
      delivered: ["Livré", "Delivered"],
      returned: ["Retourné", "Returned"],
    },
  }),
});

// ─── Route Definitions ─────────────────────────────────────────────────────────

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Delivery Companies"],
  summary: "List delivery companies",
  description: "List all delivery companies with optional filters",
  query: listQuerySchema,
  responses: {
    200: {
      description: "List of delivery companies",
      content: jsonContent(ListResponseSchema(DeliveryCompanySchema)),
    },
  },
  handler: handlers.listDeliveryCompanies,
});

const getRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Delivery Companies"],
  summary: "Get delivery company",
  description: "Get a single delivery company by ID",
  params: idParams,
  responses: {
    200: {
      description: "Delivery company details",
      content: jsonContent(SuccessResponseSchema(DeliveryCompanySchema)),
    },
  },
  handler: handlers.getDeliveryCompany,
});

const createCompanyRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.DELIVERY_CREATE },
  tags: ["Delivery Companies"],
  summary: "Create delivery company",
  description: "Create a new delivery company integration",
  body: createBodySchema,
  responses: {
    201: {
      description: "Delivery company created",
      content: jsonContent(SuccessResponseSchema(DeliveryCompanySchema)),
    },
    409: { description: "Duplicate company code" },
  },
  handler: handlers.createDeliveryCompany,
});

const updateRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_UPDATE },
  tags: ["Delivery Companies"],
  summary: "Update delivery company",
  description: "Update an existing delivery company",
  params: idParams,
  body: updateBodySchema,
  responses: {
    200: {
      description: "Delivery company updated",
      content: jsonContent(SuccessResponseSchema(DeliveryCompanySchema)),
    },
    409: { description: "Duplicate company code" },
  },
  handler: handlers.updateDeliveryCompany,
});

const deleteRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_DELETE },
  tags: ["Delivery Companies"],
  summary: "Delete delivery company",
  description: "Delete a delivery company that never carried a parcel, with its API log and webhook inbox. A company that has carried parcels keeps their history: deactivate it instead.",
  params: idParams,
  responses: {
    200: {
      description: "Delivery company deleted",
      content: jsonContent(z.object({ success: z.boolean() })),
    },
    404: { description: "Delivery company not found" },
    409: {
      description: "Parcels are still on their way (COMPANY_HAS_ACTIVE_SHIPMENTS), or the company has carried parcels (COMPANY_HAS_SHIPMENTS — deactivate it instead)",
    },
  },
  handler: handlers.deleteDeliveryCompany,
});

const getStopDesksRoute = defineRoute({
  method: "get",
  path: "/{id}/stop-desks",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Delivery Companies"],
  summary: "Get company stop desks",
  description: "Read stop desks from DB (no live API call). Admin must sync first via POST .../sync-stop-desks",
  params: idParams,
  query: stopDesksQuerySchema,
  responses: {
    200: {
      description: "Stop desks list",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            stopDesks: z.array(StopDeskSchema),
            total: z.number().int(),
            company: z.object({
              id: z.string(),
              name: z.string(),
              code: z.string(),
            }),
          }),
        })
      ),
    },
  },
  handler: handlers.fetchCompanyStopDesks,
});

const syncStopDesksRoute = defineRoute({
  method: "post",
  path: "/{id}/sync-stop-desks",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Sync stop desks",
  description: "Fetch stop desks from carrier API and upsert into DB. Active flag is preserved.",
  params: idParams,
  responses: {
    200: {
      description: "Stop desks synced",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            total: z.number().int().openapi({ description: "Total desks upserted", example: 1359 }),
            removed: z.number().int().openapi({ description: "Stale desks removed", example: 3 }),
            syncedAt: z.string().datetime(),
          }),
        })
      ),
    },
    422: { description: "Company not connected or provider does not support stop desks" },
    502: { description: "External API failure" },
  },
  handler: handlers.syncCompanyStopDesks,
});

const toggleStopDeskRoute = defineRoute({
  method: "patch",
  path: "/{id}/stop-desks/{code}/toggle",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Toggle stop desk active flag",
  description: "Toggle the active flag on a single stop desk. Admin can deactivate stop desks that can't be serviced.",
  params: toggleParams,
  responses: {
    200: {
      description: "Stop desk toggled",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            code: z.string(),
            active: z.boolean(),
          }),
        })
      ),
    },
  },
  handler: handlers.toggleCompanyStopDesk,
});

const syncGeoNamesRoute = defineRoute({
  method: "post",
  path: "/{id}/sync-geo",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Sync carrier geo names",
  description:
    "Fetch the carrier's own wilaya/commune name lists and build the per-carrier name map " +
    "(exact strings the carrier matches parcel addresses against). Yalidine-only for now — " +
    "carriers that match by name. Response reports matched and unmapped reference rows. " +
 "Dispatch resolves our wilaya/commune IDs through this map before calling the carrier.",
  params: idParams,
  responses: {
    200: {
      description: "Geo names synced",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            wilayasMatched: z.number().int().openapi({ description: "Wilayas with a carrier string stored", example: 58 }),
            wilayasUnmapped: z.number().int(),
            communesMatched: z.number().int().openapi({ description: "Communes with a carrier string stored", example: 1497 }),
            communesUnmapped: z.number().int(),
            unmappedCommunes: z.array(z.object({
              communeId: z.string(),
              ourName: z.string().openapi({ example: "Aghabal" }),
            })),
            unmappedWilayas: z.array(z.object({
              wilayaId: z.number().int(),
              ourName: z.string(),
            })),
            syncedAt: z.string().datetime(),
          }),
        })
      ),
    },
    422: { description: "Company not yalidine-style name-matching or not connected" },
    502: { description: "External API failure" },
  },
  handler: handlers.syncGeoNames,
});

const testConnectionRoute = defineRoute({
  method: "post",
  path: "/{id}/test-connection",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Delivery Companies"],
  summary: "Test carrier connection",
  description:
    "Verifies the company's stored credentials against its carrier API. " +
    "A negative outcome (invalid token, API access disabled) returns 200 with ok:false — the check itself succeeded. " +
    "Provider support: ecotrack (all 82 companies) ✅ | others ❌ OPERATION_NOT_SUPPORTED.",
  params: idParams,
  responses: {
    200: {
      description: "Connection check executed",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            companyId: z.string(),
            companyName: z.string(),
            companyCode: z.string(),
            ok: z.boolean().openapi({ description: "Whether the credentials are usable" }),
            code: z.string().openapi({
              description: "Outcome code: valid | invalid_token | not_allowed",
              example: "valid",
            }),
            message: z.string().openapi({ example: "Token is valid" }),
            details: z.record(z.string(), z.unknown()).optional().openapi({
              description:
                "Provider enrichment — EcoTrack includes servedWilayaIds + servedWilayaCount when reachable.",
            }),
          }),
        })
      ),
    },
    400: { description: "Company not connected — no API token stored" },
    422: { description: "Provider does not support connection testing" },
    502: { description: "External API failure (carrier unreachable)" },
  },
  handler: handlers.testCompanyConnection,
});

const syncShipmentsRoute = defineRoute({
  method: "post",
  path: "/{id}/sync-shipments",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Sync this company's open shipments now",
  description:
    "Reads the carrier's history of the company's open shipments — up to 50 per request, the longest unsynced first — and records every status not recorded yet (a status already received by webhook or an earlier sync is not recorded twice). " +
    "Pull-only carriers (EcoTrack platform, NOEST, Guepex) are also synced on a schedule every few minutes; this is the merchant's \"now\", for any carrier whose history can be read. Replaces reconcile-orders.",
  params: idParams,
  responses: {
    200: {
      description: "What the sync found",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            synced: z.number().int().openapi({ description: "Shipments read" }),
            recorded: z.number().int().openapi({ description: "Statuses new to CodFlow" }),
            reached: z.number().int().openapi({ description: "Milestones reached for the first time" }),
            moreRemain: z.boolean().openapi({ description: "More open shipments wait for the next sync" }),
          }),
        })
      ),
    },
    400: { description: "Company not connected — no API token stored" },
    404: { description: "Company not found" },
    422: { description: "The carrier's history cannot be read" },
    429: { description: "The carrier is throttling" },
    502: { description: "The carrier could not be reached" },
  },
  handler: handlers.syncCompanyShipments,
});

const registerWebhookRoute = defineRoute({
  method: "post",
  path: "/{id}/webhook/register",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Register ZR Express webhook",
  description: "Registers a webhook endpoint with ZR Express via their API. Stores the endpointId and signing secret.",
  params: idParams,
  responses: {
    200: {
      description: "Webhook registered",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          webhookUrl: z.string().url().openapi({ example: "https://your-worker.workers.dev/webhooks/zr_express" }),
          endpointId: z.string().openapi({ example: "ep_1234567890" }),
        })
      ),
    },
  },
  handler: webhookHandlers.registerZrWebhook,
});

const unregisterWebhookRoute = defineRoute({
  method: "delete",
  path: "/{id}/webhook/register",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Unregister ZR Express webhook",
  description: "Deletes the registered webhook endpoint from ZR Express and clears the DB fields.",
  params: idParams,
  responses: {
    200: {
      description: "Webhook unregistered",
      content: jsonContent(z.object({ success: z.boolean() })),
    },
  },
  handler: webhookHandlers.unregisterZrWebhook,
});

const saveYalidineSecretRoute = defineRoute({
  method: "patch",
  path: "/{id}/webhook/secret",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Save Yalidine webhook secret",
  description: "Stores the Yalidine webhook secret key (entered manually after setting up webhook in Yalidine dashboard).",
  params: idParams,
  body: saveSecretBodySchema,
  responses: {
    200: {
      description: "Secret saved",
      content: jsonContent(z.object({ success: z.boolean() })),
    },
  },
  handler: webhookHandlers.saveYalidineSecret,
});

const saveZrMappingRoute = defineRoute({
  method: "patch",
  path: "/{id}/webhook/mapping",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Save ZR status mapping",
  description: "Saves the custom ZR state name → our status mapping for this company.",
  params: idParams,
  body: saveMappingBodySchema,
  responses: {
    200: {
      description: "Mapping saved",
      content: jsonContent(z.object({ success: z.boolean() })),
    },
  },
  handler: webhookHandlers.saveZrStatusMapping,
});

const webhookEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25).openapi({
    description: "Page size (1-100)",
    example: 25,
  }),
  offset: z.coerce.number().int().min(0).default(0).openapi({
    description: "Offset for keyset-free pagination",
    example: 0,
  }),
  result: z.enum(INBOX_RESULT_FILTERS).optional().openapi({
    description: "Filter by processing result — the operational lens: error and dead need attention, unmatched and unknown_status may need a parcel attached or a status mapped",
  }),
});

const listWebhookEventsRoute = defineRoute({
  method: "get",
  path: "/{id}/webhook/events",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Delivery Companies"],
  summary: "List inbound webhook events",
  description:
    "The company's webhook inbox, newest first: every event its carrier pushed, with what processing made of it — " +
    "ok, ignored, unmatched (no shipment has that parcel), unknown_status (recorded, but a status CodFlow does not interpret), " +
    "deferred_settlement (a money event), error (to be retried at nextAttemptAt) or dead (tries spent). " +
    "Each row names the shipment it was recorded on and its order. rawPayload is left out: the log's value is the outcome.",
  params: idParams,
  query: webhookEventsQuerySchema,
  responses: {
    200: {
      description: "Webhook events page",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            events: z.array(
              z.object({
                id: z.string().openapi({ example: "b537eb81-e24d-4df5-be7a-b3bf3293a524" }),
                provider: z.enum(["zr_express", "yalidine"]).openapi({ example: "yalidine" }),
                eventId: z.string().openapi({ description: "Idempotency key (event_id / svix-id)" }),
                tracking: z.string().nullable(),
                eventType: z.string().openapi({ example: "parcel_status_updated" }),
                result: z.enum(INBOX_RESULT_FILTERS),
                newStatus: z.string().nullable().openapi({ description: "Order status set by the old webhook handler (older rows only)" }),
                reason: z.string().nullable().openapi({ description: "Carrier reason / status string (Tentative échouée's reason, unmapped status)" }),
                errorMsg: z.string().nullable(),
                shipmentId: z.string().nullable().openapi({ description: "The shipment the event was recorded on" }),
                orderId: z.string().nullable(),
                orderNumber: z.string().nullable().openapi({ description: "Joined from orders for display" }),
                attempts: z.number().int().openapi({ description: "Times processing was tried" }),
                nextAttemptAt: z.string().nullable().openapi({ description: "When processing is tried again (error only)" }),
                processedAt: z.string().nullable(),
                createdAt: z.string().datetime(),
              })
            ),
            total: z.number().int().openapi({ description: "Total rows matching the filter (for pagination)" }),
          }),
        })
      ),
    },
    404: { description: "Company not found" },
  },
  handler: handlers.listWebhookEvents,
});

const retryWebhookEventRoute = defineRoute({
  method: "post",
  path: "/{id}/webhook/events/{eventId}/retry",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Delivery Companies"],
  summary: "Process an inbox event again",
  description:
    "Processes an event that ended in error, dead, unmatched or unknown_status again, now — after fixing the company's settings, attaching its parcel, or mapping its status. Its tries start over.",
  params: idParams.extend({ eventId: z.string().openapi({ description: "Inbox event id" }) }),
  responses: {
    200: {
      description: "What processing made of it this time",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({ result: z.string(), errorMsg: z.string().nullable(), shipmentId: z.string().nullable() }),
        })
      ),
    },
    404: { description: "No such event for this company" },
    409: { description: "The event is not in a state that is processed again (ok, ignored, pending, deferred_settlement)" },
  },
  handler: handlers.retryWebhookEvent,
});

// ─── Route Registrations ───────────────────────────────────────────────────────


// GET /delivery-companies — list all companies
deliveryCompaniesRouter.openapi(listRoute.route, listRoute.handler);

// GET /delivery-companies/:id — get single company
deliveryCompaniesRouter.openapi(getRoute.route, getRoute.handler);

// GET /delivery-companies/:id/stop-desks — read from company_stop_desks DB (no live API)
deliveryCompaniesRouter.openapi(getStopDesksRoute.route, getStopDesksRoute.handler);

// POST /delivery-companies/:id/sync-stop-desks — fetch from carrier API and upsert into DB
deliveryCompaniesRouter.openapi(syncStopDesksRoute.route, syncStopDesksRoute.handler);

// POST /delivery-companies/:id/sync-geo — build the per-carrier name map
deliveryCompaniesRouter.openapi(syncGeoNamesRoute.route, syncGeoNamesRoute.handler);

// POST /delivery-companies/:id/test-connection — verify stored credentials at the carrier
deliveryCompaniesRouter.openapi(testConnectionRoute.route, testConnectionRoute.handler);

// POST /delivery-companies/:id/reconcile-orders — pull-based status drift repair (EcoTrack only)
deliveryCompaniesRouter.openapi(syncShipmentsRoute.route, syncShipmentsRoute.handler);

// PATCH /delivery-companies/:id/stop-desks/:code/toggle — toggle admin active flag
deliveryCompaniesRouter.openapi(toggleStopDeskRoute.route, toggleStopDeskRoute.handler);

// POST /delivery-companies — create company
deliveryCompaniesRouter.openapi(createCompanyRoute.route, createCompanyRoute.handler);

// PATCH /delivery-companies/:id — update company
deliveryCompaniesRouter.openapi(updateRoute.route, updateRoute.handler);

// DELETE /delivery-companies/:id — delete company
deliveryCompaniesRouter.openapi(deleteRoute.route, deleteRoute.handler);

// ── Webhook Management ────────────────────────────────────────────────────────

// POST /delivery-companies/:id/webhook/register — register ZR Express webhook endpoint
deliveryCompaniesRouter.openapi(registerWebhookRoute.route, registerWebhookRoute.handler);

// DELETE /delivery-companies/:id/webhook/register — unregister ZR Express webhook endpoint
deliveryCompaniesRouter.openapi(unregisterWebhookRoute.route, unregisterWebhookRoute.handler);

// PATCH /delivery-companies/:id/webhook/secret — save Yalidine webhook secret
deliveryCompaniesRouter.openapi(saveYalidineSecretRoute.route, saveYalidineSecretRoute.handler);

// PATCH /delivery-companies/:id/webhook/mapping — save ZR custom state name mapping
deliveryCompaniesRouter.openapi(saveZrMappingRoute.route, saveZrMappingRoute.handler);

// GET /delivery-companies/:id/webhook/events — read the inbound webhook event log
deliveryCompaniesRouter.openapi(listWebhookEventsRoute.route, listWebhookEventsRoute.handler);
deliveryCompaniesRouter.openapi(retryWebhookEventRoute.route, retryWebhookEventRoute.handler);

export default deliveryCompaniesRouter;
