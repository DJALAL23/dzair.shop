/**
 * The audit trail of carrier calls (`company_api_logs`): every operation
 * CodFlow asked of a carrier, for which order, how it ended and how long it
 * took. Writing the trail never fails the operation it records.
 */

import type { AppDb } from "../../../cod-shared/db/client";
import { companyApiLogs } from "../../../cod-shared/db/schema";
import { isCarrierError } from "./contract";

export interface CarrierCallEntry {
  companyId: string;
  orderId?: string | null;
  /** The contract operation, e.g. `createShipment`. */
  operation: string;
}

async function write(db: AppDb, entry: CarrierCallEntry, outcome: { success: boolean; durationMs: number; error?: unknown; response?: unknown }) {
  const error = outcome.error;
  try {
    await db.insert(companyApiLogs).values({
      id: crypto.randomUUID(),
      companyId: entry.companyId,
      orderId: entry.orderId ?? null,
      action: entry.operation,
      method: "CALL",
      endpoint: entry.operation,
      requestBody: null,
      httpStatus: isCarrierError(error) ? error.httpStatus : outcome.success ? 200 : null,
      responseBody: outcome.response === undefined ? null : JSON.stringify(outcome.response),
      success: outcome.success,
      errorMessage: error === undefined ? null : isCarrierError(error) ? `${error.kind}: ${error.message}` : String((error as Error)?.message ?? error),
      durationMs: outcome.durationMs,
      createdAt: new Date().toISOString(),
    });
  } catch (cause) {
    console.error(`[carrier-log] could not record ${entry.operation} for company=${entry.companyId}:`, (cause as Error)?.message);
  }
}

/** Run one carrier operation and record it; its result or error passes through unchanged. */
export async function loggedCarrierCall<T>(
  db: AppDb,
  entry: CarrierCallEntry,
  call: () => Promise<T>,
  responseOf: (result: T) => unknown = () => undefined,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await call();
    await write(db, entry, { success: true, durationMs: Date.now() - started, response: responseOf(result) });
    return result;
  } catch (error) {
    await write(db, entry, { success: false, durationMs: Date.now() - started, error });
    throw error;
  }
}
