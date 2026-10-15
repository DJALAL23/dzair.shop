/**
 * Delivery Companies Queries
 *
 * CRUD operations for third-party delivery company management.
 */

import { eq, and, like, desc, count, notExists, sql } from "drizzle-orm";
import { companyApiLogs, deliveryCompanies, shipments, webhookEvents } from "../db/schema";
import type { AppDb } from "../db/client";
import { isSecretSetting, maskSecret, maskedSettings, type CarrierProvider } from "../carriers/providers";

export interface DeliveryCompanyFilters {
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateDeliveryCompanyData {
  provider?: CarrierProvider | null;
  /** Already merged and validated JSON (see the carrier registry's mergeProviderConfig). */
  providerConfig?: string | null;
  name: string;
  nameAr: string;
  code: string;
  website?: string | null;
  active: boolean;
  apiEndpoint?: string | null;
  apiToken?: string | null;
  apiUserGuid?: string | null;
  supportsHomeDelivery: boolean;
  supportsStopDesk: boolean;
  supportsTracking: boolean;
  /** When omitted, the DB default (true) applies. Provider-specific defaults live at the HTTP handler. */
  autoValidate?: boolean;
  notes?: string | null;
}

export interface UpdateDeliveryCompanyData {
  provider?: CarrierProvider | null;
  /** Already merged and validated JSON (see the carrier registry's mergeProviderConfig). */
  providerConfig?: string | null;
  name?: string;
  nameAr?: string;
  code?: string;
  website?: string | null;
  active?: boolean;
  apiEndpoint?: string | null;
  apiToken?: string | null;
  apiUserGuid?: string | null;
  supportsHomeDelivery?: boolean;
  supportsStopDesk?: boolean;
  supportsTracking?: boolean;
  autoValidate?: boolean;
  notes?: string | null;
}

/** `notes` may carry carrier settings as JSON; any secret in it is masked. */
function maskNotes(notes: string | null): string | null {
  if (!notes) return notes;
  try {
    const parsed = JSON.parse(notes) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return notes;
    const settings = { ...(parsed as Record<string, unknown>) };
    for (const key of Object.keys(settings)) {
      if (isSecretSetting(key) && typeof settings[key] === "string") settings[key] = maskSecret(settings[key] as string);
    }
    return JSON.stringify(settings);
  } catch {
    return notes;
  }
}

/**
 * A company as an API response may show it: credentials leave as an
 * `isConnected` flag, and the webhook signing secret and any secret kept in
 * `notes` leave masked. Built field by field — a new column is invisible here
 * until someone decides it is safe to show.
 */
function sanitize(company: typeof deliveryCompanies.$inferSelect) {
  return {
    id: company.id,
    name: company.name,
    nameAr: company.nameAr,
    code: company.code,
    website: company.website,
    active: company.active,
    apiEndpoint: company.apiEndpoint,
    isConnected: !!company.apiToken,
    supportsHomeDelivery: company.supportsHomeDelivery,
    supportsStopDesk: company.supportsStopDesk,
    supportsTracking: company.supportsTracking,
    webhookSecret: maskSecret(company.webhookSecret),
    webhookEndpointId: company.webhookEndpointId,
    webhookStatusMapping: company.webhookStatusMapping,
    autoValidate: company.autoValidate,
    notes: maskNotes(company.notes),
    provider: company.provider,
    providerConfig: maskedSettings(company.providerConfig),
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

export async function getAllDeliveryCompanies(
  db: AppDb,
  filters?: DeliveryCompanyFilters,
) {
  const conditions = [];

  if (filters?.active !== undefined) {
    conditions.push(eq(deliveryCompanies.active, filters.active));
  }

  if (filters?.search) {
    conditions.push(like(deliveryCompanies.name, `%${filters.search}%`));
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  let query = db.select().from(deliveryCompanies);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query
    .orderBy(desc(deliveryCompanies.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map(sanitize);
}

export async function getDeliveryCompanyById(db: AppDb, id: string) {
  const row = await db
    .select()
    .from(deliveryCompanies)
    .where(eq(deliveryCompanies.id, id))
    .get();
  return row ? sanitize(row) : null;
}

export async function getDeliveryCompanyByCode(db: AppDb, code: string) {
  return await db
    .select()
    .from(deliveryCompanies)
    .where(eq(deliveryCompanies.code, code))
    .get();
}

/**
 * Internal: get raw company record including credentials. Used by providers/handlers
 * that need to make outbound API calls. Never returned to clients.
 */
export async function getDeliveryCompanyRaw(db: AppDb, id: string) {
  return await db
    .select()
    .from(deliveryCompanies)
    .where(eq(deliveryCompanies.id, id))
    .get();
}

export async function createDeliveryCompany(
  db: AppDb,
  data: CreateDeliveryCompanyData,
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(deliveryCompanies).values({
    id,
    name: data.name,
    nameAr: data.nameAr,
    code: data.code,
    website: data.website ?? null,
    active: data.active,
    apiEndpoint: data.apiEndpoint ?? null,
    apiToken: data.apiToken ?? null,
    apiUserGuid: data.apiUserGuid ?? null,
    supportsHomeDelivery: data.supportsHomeDelivery,
    supportsStopDesk: data.supportsStopDesk,
    supportsTracking: data.supportsTracking,
    // Only forward autoValidate when the caller supplied a value — otherwise
    // fall through to the DB column default (true). Keeps behavior symmetric
    // with all other optional columns in this insert.
    ...(data.autoValidate !== undefined ? { autoValidate: data.autoValidate } : {}),
    notes: data.notes ?? null,
    provider: data.provider ?? null,
    providerConfig: data.providerConfig ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getDeliveryCompanyById(db, id);
}

export async function updateDeliveryCompany(
  db: AppDb,
  id: string,
  data: UpdateDeliveryCompanyData,
) {
  const existing = await getDeliveryCompanyById(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();

  await db
    .update(deliveryCompanies)
    .set({ ...data, updatedAt: now })
    .where(eq(deliveryCompanies.id, id));

  return getDeliveryCompanyById(db, id);
}

export type CompanyDeletion =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_shipments"; open: number; total: number };

/**
 * Delete a delivery company that never carried a shipment, with its API log
 * and inbox. A company that has carried parcels keeps them (their history,
 * and the inbox that recorded it), so it is deactivated instead. The check is
 * part of every statement of the delete, so a parcel handed to the company
 * meanwhile keeps it.
 */
export async function deleteDeliveryCompany(db: AppDb, id: string): Promise<CompanyDeletion> {
  const noShipment = notExists(db.select({ one: sql`1` }).from(shipments).where(eq(shipments.companyId, id)));
  const results = await db.batch([
    db.delete(companyApiLogs).where(and(eq(companyApiLogs.companyId, id), noShipment)),
    db.delete(webhookEvents).where(and(eq(webhookEvents.companyId, id), noShipment)),
    db.delete(deliveryCompanies).where(and(eq(deliveryCompanies.id, id), noShipment)),
  ]);
  if (((results[2] as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) return { ok: true };

  const held = await db
    .select({
      total: count(),
      open: sql<number>`coalesce(sum(case when ${shipments.deliveredAt} is null and ${shipments.returnedAt} is null and ${shipments.cancelledAt} is null then 1 else 0 end), 0)`,
    })
    .from(shipments)
    .where(eq(shipments.companyId, id))
    .get();
  const total = Number(held?.total ?? 0);
  return total > 0 ? { ok: false, reason: "has_shipments", open: Number(held?.open ?? 0), total } : { ok: false, reason: "not_found" };
}
