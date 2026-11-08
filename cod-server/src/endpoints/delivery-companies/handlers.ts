/**
 * Delivery Companies Route Handlers
 *
 * HTTP handlers for delivery company CRUD operations.
 */

import { Context } from "hono";
import { carrierAuthor } from "@/lib/acting";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { eq, and, lt, sql, desc, asc, count, isNull } from "drizzle-orm";
import { companyStopDesks, webhookEvents, orders, shipments } from "@/db/schema";
import * as queries from "./queries";
import * as validation from "./validation";
import { companyView } from "./view";
import { buildCarrier, mergeProviderConfig, providerCapabilities, type CarrierCompany } from "@/carriers/registry";
import { CarrierError } from "@/carriers/contract";
import type { CarrierProvider } from "../../../../cod-shared/carriers/providers";
import { callCarrier, requireCapability } from "@/carriers/app-errors";
import type { CarrierAdapter } from "@/carriers/contract";
import { syncShipments } from "@/endpoints/shipments/sync";
import { processInboxEvent } from "@/inbound/process";
import { requeueInboxEvent } from "../../../../cod-shared/inbound/inbox";
import { NotFoundError, ValidationError, BusinessLogicError, ConflictError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { carrierPlacesSummary, carrierRatesByWilaya, syncCarrierPlaces } from "../../../../cod-shared/carriers/places";
import { storeStopDesks } from "./stop-desks";

/**
 * GET /delivery-companies
 * List all delivery companies with optional filters.
 */
export async function listDeliveryCompanies(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const filters = (c.req as any).valid?.("query") ?? {
    active: c.req.query("active"),
    search: c.req.query("search"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  };
  const parsed = validation.deliveryCompanyFiltersSchema.parse(filters);
  const data = await queries.getAllDeliveryCompanies(db, parsed);
  return c.json({ success: true, data: data.map(companyView), count: data.length }, 200);
}

/**
 * GET /delivery-companies/:id
 * Get a single delivery company by ID.
 */
export async function getDeliveryCompany(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const company = await queries.getDeliveryCompanyById(db, id);
  
  if (!company) {
    throw new NotFoundError("Delivery company", id);
  }

  return c.json({ success: true, data: { ...companyView(company), places: await carrierPlacesSummary(db, id) } }, 200);
}


/**
 * A carrier that can check a token must accept it before the company is saved
 * as connected: a typo would otherwise show "Connected" and fail on the first
 * parcel. A carrier that cannot be reached is refused too, with its own error,
 * so the merchant knows the token is not the problem.
 */
async function assertCredentialsAccepted(company: CarrierCompany, context: { code: string; companyId?: string }): Promise<void> {
  if (!company.apiToken?.trim()) return;
  if (!providerCapabilities(company.provider, parseSettings(company.providerConfig))?.verifyConnection) return;
  await callCarrier(context, async () => {
    const check = await buildCarrier(company).verifyConnection!();
    if (!check.ok) throw new CarrierError(company.provider!, "auth", check.message);
  });
}


/**
 * Read the carrier's list of places into the company's map, as part of
 * connecting: the merchant has nothing to map. A list that cannot be read
 * does not undo the connection; the company then has no map, the page says
 * so, and every hand-off is refused until it is read (never sent under our
 * own names).
 */
async function readCarrierPlaces(db: ReturnType<typeof getDb>, companyId: string, company: CarrierCompany & { code: string }): Promise<void> {
  if (!company.apiToken?.trim() || !company.provider) return;
  try {
    const result = await syncCarrierPlaces(db, companyId, await buildCarrier(company).places());
    console.info(`[delivery-companies] places code=${company.code} communes=${result.communes} home=${result.home} priced=${result.priced} unmatched=${result.unmatched.length}`);
  } catch (error) {
    console.warn(`[delivery-companies] places not read for ${company.code}:`, error instanceof Error ? error.message : error);
  }
}

function parseSettings(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /delivery-companies
 * Create a new delivery company.
 */
export async function createDeliveryCompany(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid?.("json") ?? await c.req.json();
  const parsed = validation.createDeliveryCompanySchema.parse(body);

  // Ensure code is unique
  const existing = await queries.getDeliveryCompanyByCode(db, parsed.code);
  if (existing) {
    throw new ConflictError(
      `A delivery company with code "${parsed.code}" already exists`,
      ERROR_CODES.DUPLICATE_ENTITY,
      { code: parsed.code, existingCompanyId: existing.id }
    );
  }

  const provider = parsed.provider ?? null;
  const providerConfig = settingsFor(provider, null, parsed.providerConfig);

  // A carrier with a separate validation step (EcoTrack, NOEST) locks an order
  // the moment it is validated — the team would lose the ability to edit or
  // delete it after dispatch — so it defaults to manual validation; everyone
  // else validates at once.
  const autoValidate = parsed.autoValidate ?? !providerCapabilities(provider, parseSettings(providerConfig))?.separateValidation;

  if (parsed.active) {
    await assertCredentialsAccepted(
      { provider, providerConfig, apiToken: parsed.apiToken ?? null, apiUserGuid: parsed.apiUserGuid ?? null, apiEndpoint: parsed.apiEndpoint ?? null },
      { code: parsed.code },
    );
  }

  const company = await queries.createDeliveryCompany(db, { ...parsed, provider, providerConfig, autoValidate });
  if (!company) {
    throw new BusinessLogicError("Failed to create delivery company", ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
  if (parsed.active) {
    await readCarrierPlaces(db, company.id, { provider, providerConfig, apiToken: parsed.apiToken ?? null, apiUserGuid: parsed.apiUserGuid ?? null, apiEndpoint: parsed.apiEndpoint ?? null, code: parsed.code });
  }
  console.info(`[delivery-companies] created company=${company.id} code=${parsed.code} autoValidate=${autoValidate}`);
  return c.json({ success: true, data: companyView(company) }, 201);
}

/**
 * PATCH /delivery-companies/:id
 * Update a delivery company.
 */
export async function updateDeliveryCompany(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const body = (c.req as any).valid?.("json") ?? await c.req.json();
  const parsed = validation.updateDeliveryCompanySchema.parse(body);

  // If code is being changed, verify it's not taken by another company
  if (parsed.code) {
    const existing = await queries.getDeliveryCompanyByCode(db, parsed.code);
    if (existing && existing.id !== id) {
      throw new ConflictError(
        `A delivery company with code "${parsed.code}" already exists`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { code: parsed.code, existingCompanyId: existing.id }
      );
    }
  }

  const { provider: requestedProvider, providerConfig: settingsPatch, ...fields } = parsed;
  let settings: { provider?: CarrierProvider | null; providerConfig?: string | null } = {};
  if (requestedProvider !== undefined || settingsPatch !== undefined) {
    const stored = await queries.getDeliveryCompanyRaw(db, id);
    if (!stored) throw new NotFoundError("Delivery company", id);
    const provider = requestedProvider === undefined ? stored.provider : requestedProvider;
    // A different adapter starts from its own defaults, not the old one's settings.
    const base = provider === stored.provider ? stored.providerConfig : null;
    settings = { provider, providerConfig: settingsFor(provider, base, settingsPatch) };
  }

  const stored = await queries.getDeliveryCompanyRaw(db, id);
  if (!stored) throw new NotFoundError("Delivery company", id);
  const wasActive = stored.active;
  const touchesCredentials =
    fields.apiToken !== undefined || fields.apiEndpoint !== undefined || requestedProvider !== undefined || (fields.active === true && !wasActive);
  const connecting = (fields.active ?? wasActive) && touchesCredentials;
  const effective: CarrierCompany = {
    provider: settings.provider === undefined ? stored.provider : settings.provider,
    providerConfig: settings.providerConfig === undefined ? stored.providerConfig : settings.providerConfig,
    apiToken: fields.apiToken === undefined ? stored.apiToken : fields.apiToken,
    apiUserGuid: fields.apiUserGuid === undefined ? stored.apiUserGuid : fields.apiUserGuid,
    apiEndpoint: fields.apiEndpoint === undefined ? stored.apiEndpoint : fields.apiEndpoint,
  };
  if (connecting) await assertCredentialsAccepted(effective, { code: stored.code, companyId: id });

  const company = await queries.updateDeliveryCompany(db, id, { ...fields, ...settings });
  
  if (!company) {
    throw new NotFoundError("Delivery company", id);
  }

  if (connecting) await readCarrierPlaces(db, id, { ...effective, code: company.code });
  console.info(`[delivery-companies] updated company=${id}`);
  return c.json({ success: true, data: companyView(company) }, 200);
}

/**
 * POST /delivery-companies/:id/sync-stop-desks
 * Fetch stop desks from the carrier API and upsert into company_stop_desks.
 * The `active` flag is NEVER overwritten — preserves admin's manual deactivations.
 */
export async function syncCompanyStopDesks(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };

  const company = await queries.getDeliveryCompanyRaw(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);

  const context = { companyId: id, code: company.code };
  const carrier = await connectedCarrier(company, context);
  requireCapability(carrier.capabilities.stopDeskList, "listing stop desks", context);
  const desks = await callCarrier(context, () => carrier.stopDesks!());

  const result = await storeStopDesks(db, id, desks);
  console.info(`[sync-stop-desks] company=${id} code=${company.code} total=${result.total} removed=${result.removed} unplaced=${result.unplaced}`);
  return c.json({ success: true, data: result }, 200);
}

/**
 * POST /delivery-companies/:id/test-connection
 * Verify the company's stored credentials against its carrier API.
 * A negative check outcome (invalid token, API access disabled) is a
 * successful execution — HTTP 200 with ok:false — not an error.
 * Transport failures (timeout, carrier down) surface as 502.
 */
export async function testCompanyConnection(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };

  const company = await queries.getDeliveryCompanyRaw(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);

  const context = { companyId: id, code: company.code };
  const carrier = await connectedCarrier(company, context);
  requireCapability(carrier.capabilities.verifyConnection, "connection testing", context);
  const startMs = Date.now();
  const result = await callCarrier(context, () => carrier.verifyConnection!());

  console.info(
    `[test-connection] company=${id} code=${company.code} ok=${result.ok} (${Date.now() - startMs}ms)`,
  );
  return c.json({
    success: true,
    data: {
      companyId: id,
      companyName: company.name,
      companyCode: company.code,
      ...result,
    },
  }, 200);
}

/** Shipments synced per request; the rest wait for the next request or the schedule. */
export const SYNC_NOW_LIMIT = 50;

/**
 * POST /delivery-companies/:id/sync-shipments
 * Read the carrier's history of this company's open shipments now — the
 * longest unsynced first — and record what is new. The schedule does the
 * same for pull-only carriers every few minutes; this is the merchant's
 * "now", for any carrier whose history can be read.
 */
export async function syncCompanyShipments(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const company = await queries.getDeliveryCompanyRaw(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);
  const context = { companyId: id, code: company.code };
  const carrier = await connectedCarrier(company, context);
  requireCapability(carrier.capabilities.history, "reading a parcel's history", context);

  const open = await db
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.companyId, id),
        eq(shipments.handoffState, "accepted"),
        isNull(shipments.deliveredAt),
        isNull(shipments.returnedAt),
        isNull(shipments.cancelledAt),
      ),
    )
    .orderBy(asc(shipments.lastSyncedAt), asc(shipments.createdAt))
    .limit(SYNC_NOW_LIMIT + 1)
    .all();
  const due = open.slice(0, SYNC_NOW_LIMIT);
  const recorded = await callCarrier(context, () => syncShipments(db, carrier, due, carrierAuthor(company, "carrier_sync")));
  const results = [...recorded.values()];

  return c.json({
    success: true,
    data: {
      synced: recorded.size,
      recorded: results.reduce((n, r) => n + r.recorded, 0),
      reached: results.reduce((n, r) => n + r.reached.length, 0),
      moreRemain: open.length > SYNC_NOW_LIMIT,
    },
  }, 200);
}

/**
 * GET /delivery-companies/:id/stop-desks
 * Read stop desks from company_stop_desks DB table.
 * Supports ?wilayaId= and ?activeOnly=true filters.
 * No live API call — admin must sync first via POST .../sync-stop-desks.
 */
export async function fetchCompanyStopDesks(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const query = (c.req as any).valid?.("query") ?? {
    wilayaId: c.req.query("wilayaId"),
    activeOnly: c.req.query("activeOnly") ?? "true",
  };

  const company = await queries.getDeliveryCompanyById(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);

  const wilayaIdParam = query.wilayaId;
  const activeOnly = query.activeOnly !== "false"; // default true

  const conditions = [eq(companyStopDesks.companyId, id)];

  if (wilayaIdParam) {
    conditions.push(eq(companyStopDesks.wilayaId, parseInt(wilayaIdParam, 10)));
  }

  if (activeOnly) {
    conditions.push(eq(companyStopDesks.active, true));
  }

  const rows = await db
    .select()
    .from(companyStopDesks)
    .where(and(...conditions))
    .orderBy(companyStopDesks.name)
    .all();

  const desks = rows.map((r) => ({
    ...r,
    phones: r.phones ? JSON.parse(r.phones) as string[] : [],
  }));

  return c.json({
    success: true,
    data: {
      stopDesks: desks,
      total: desks.length,
      company: { id: company.id, name: company.name, code: company.code },
    },
  }, 200);
}

/**
 * PATCH /delivery-companies/:id/stop-desks/:code/toggle
 * Toggle the `active` flag on a single stop desk.
 * Admin can deactivate stop desks that their account can't service.
 * This toggle survives re-syncs.
 */
export async function toggleCompanyStopDesk(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const params = (c.req as any).valid?.("param") ?? { id: c.req.param("id")!, code: c.req.param("code")! };
  const companyId = params.id;
  const code = params.code;

  const existing = await db
    .select({ id: companyStopDesks.id, active: companyStopDesks.active })
    .from(companyStopDesks)
    .where(
      and(
        eq(companyStopDesks.companyId, companyId),
        eq(companyStopDesks.code, code),
      )
    )
    .get();

  if (!existing) {
    throw new NotFoundError("Stop desk", `${companyId}/${code}`);
  }

  const newActive = !existing.active;
  await db
    .update(companyStopDesks)
    .set({ active: newActive })
    .where(eq(companyStopDesks.id, existing.id));

  return c.json({ success: true, data: { code, active: newActive } }, 200);
}

/**
 * DELETE /delivery-companies/:id
 * Delete a delivery company.
 */
export async function deleteDeliveryCompany(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };

  const existing = await queries.getDeliveryCompanyById(db, id);
  
  if (!existing) {
    throw new NotFoundError("Delivery company", id);
  }

  const deleted = await queries.deleteDeliveryCompany(db, id);
  if (!deleted.ok) {
    if (deleted.reason === "not_found") throw new NotFoundError("Delivery company", id);
    const context = { companyId: id, openShipments: deleted.open, shipments: deleted.total };
    throw deleted.open > 0
      ? new ConflictError(`${existing.name} still has ${deleted.open} parcel(s) on their way; they must be delivered, returned or voided first`, ERROR_CODES.COMPANY_HAS_ACTIVE_SHIPMENTS, context)
      : new ConflictError(`${existing.name} has carried parcels whose history is kept; deactivate it instead`, ERROR_CODES.COMPANY_HAS_SHIPMENTS, context);
  }

  console.info(`[delivery-companies] deleted company=${id}`);
  return c.json({ success: true }, 200);
}

/**
 * POST /delivery-companies/:id/sync-places
 *
 * Read the carrier's list of places again into the company's map. Connecting
 * a company and the hourly job already do it; the route is for now.
 */
export async function syncCompanyPlaces(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };

  const company = await queries.getDeliveryCompanyRaw(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);

  const context = { companyId: id, code: company.code };
  const carrier = await connectedCarrier(company, context);
  const result = await syncCarrierPlaces(db, id, await callCarrier(context, () => carrier.places()));
  console.info(`[delivery-companies] places company=${id} code=${company.code} communes=${result.communes} home=${result.home} priced=${result.priced} unmatched=${result.unmatched.length}`);
  return c.json({ success: true, data: await carrierPlacesSummary(db, id) }, 200);
}

/**
 * GET /delivery-companies/:id/rates
 *
 * What the company charges, by our wilaya, from its map of places.
 */
export async function getCompanyRates(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const company = await queries.getDeliveryCompanyRaw(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);
  return c.json({ success: true, data: await carrierRatesByWilaya(db, id) }, 200);
}

/**
 * GET /delivery-companies/:id/webhook/events
 *
 * Reads the company's inbound webhook event log — every delivery from every
 * webhook-capable carrier lands in webhook_events with its processing
 * outcome. Carrier-agnostic (provider column distinguishes Yalidine vs ZR).
 * Newest first; orderNumber joined for display; rawPayload excluded.
 */
export async function listWebhookEvents(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")! };
  const query = (c.req as any).valid?.("query") ?? {
    limit: 25,
    offset: 0,
    result: c.req.query("result"),
  };

  const company = await queries.getDeliveryCompanyById(db, id);
  if (!company) throw new NotFoundError("Delivery company", id);

  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const conditions = [eq(webhookEvents.companyId, id)];
  if (query.result) {
    conditions.push(eq(webhookEvents.result, String(query.result)));
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: webhookEvents.id,
        provider: webhookEvents.provider,
        eventId: webhookEvents.eventId,
        tracking: webhookEvents.tracking,
        eventType: webhookEvents.eventType,
        result: webhookEvents.result,
        reason: webhookEvents.reason,
        errorMsg: webhookEvents.errorMsg,
        shipmentId: webhookEvents.shipmentId,
        orderId: shipments.orderId,
        orderNumber: orders.orderNumber,
        attempts: webhookEvents.attempts,
        nextAttemptAt: webhookEvents.nextAttemptAt,
        processedAt: webhookEvents.processedAt,
        createdAt: webhookEvents.createdAt,
      })
      .from(webhookEvents)
      .leftJoin(shipments, eq(webhookEvents.shipmentId, shipments.id))
      .leftJoin(orders, eq(orders.id, shipments.orderId))
      .where(where)
      .orderBy(desc(webhookEvents.createdAt), desc(webhookEvents.id))
      .limit(limit)
      .offset(offset)
      .all(),
    db
      .select({ total: count() })
      .from(webhookEvents)
      .where(where)
      .get(),
  ]);

  return c.json(
    {
      success: true,
      data: {
        events: rows,
        total: Number(countRow?.total ?? 0),
      },
    },
    200,
  );
}


/**
 * POST /delivery-companies/:id/webhook/events/:eventId/retry
 * Process an inbox event again now — after fixing the company's settings,
 * attaching its parcel, or for a dead letter. Its tries start over.
 */
export async function retryWebhookEvent(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id, eventId } = (c.req as any).valid?.("param") ?? { id: c.req.param("id")!, eventId: c.req.param("eventId")! };
  const event = await db
    .select({ id: webhookEvents.id, result: webhookEvents.result })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.companyId, id)))
    .get();
  if (!event) throw new NotFoundError("Webhook event", eventId);
  if (!(await requeueInboxEvent(db, eventId))) {
    throw new ConflictError(`An event that is "${event.result}" is not processed again`, ERROR_CODES.VALIDATION_FAILED, { eventId, result: event.result });
  }
  const outcome = await processInboxEvent(db, eventId);
  const row = await db.select({ result: webhookEvents.result, errorMsg: webhookEvents.errorMsg, shipmentId: webhookEvents.shipmentId }).from(webhookEvents).where(eq(webhookEvents.id, eventId)).get();
  return c.json({ success: true, data: { result: outcome?.result ?? row?.result, errorMsg: row?.errorMsg ?? null, shipmentId: row?.shipmentId ?? null } }, 200);
}

/**
 * The carrier adapter for a company that has credentials. A company never
 * connected answers 400 (as before); incomplete credentials or settings
 * answer the carrier's "misconfigured" error.
 */
async function connectedCarrier(
  company: NonNullable<Awaited<ReturnType<typeof queries.getDeliveryCompanyRaw>>>,
  context: { companyId: string; code: string },
): Promise<CarrierAdapter> {
  if (!company.apiToken) {
    throw new ValidationError(
      `${company.name} is not connected — add API credentials first`,
      ERROR_CODES.MISSING_API_CREDENTIALS,
      { companyId: context.companyId }
    );
  }
  return callCarrier(context, () => buildCarrier(company));
}

/**
 * The settings to store for a company: the patch merged onto what is stored
 * and validated by the provider's schema. A company with no adapter has none.
 */
function settingsFor(
  provider: CarrierProvider | null,
  stored: string | null,
  patch: Record<string, unknown> | undefined,
): string | null {
  if (!provider) {
    if (patch && Object.keys(patch).length > 0) {
      throw new ValidationError("Carrier settings need a provider", ERROR_CODES.VALIDATION_FAILED, { field: "providerConfig" });
    }
    return null;
  }
  const merged = mergeProviderConfig(provider, stored, patch ?? {});
  if (!merged.ok) {
    throw new ValidationError(`Invalid ${provider} settings: ${merged.message}`, ERROR_CODES.VALIDATION_FAILED, { field: "providerConfig" });
  }
  return merged.json;
}
