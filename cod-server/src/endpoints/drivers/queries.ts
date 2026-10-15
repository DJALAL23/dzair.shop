/**
 * Drivers Database Queries
 *
 * Pure CRUD + compensation helpers live in cod-shared.
 * deleteDriver stays here because it raises ConflictError (server-only).
 */

import { and, count, eq, notExists, sql } from "drizzle-orm";
import { drivers, shipments } from "@/db/schema";
import type { AppDb } from "@/db";
import { ConflictError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

export {
  getAllDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  updateDriverStatus,
  getCompensationsForDriver,
  setCompensation,
  deleteCompensation,
} from "../../../../cod-shared/queries/drivers";

export type {
  DriverCompensationRow,
} from "../../../../cod-shared/queries/drivers";

/**
 * Delete a driver who never had a shipment. A driver with orders still out
 * must have them finished or taken back first; one with past deliveries
 * keeps them — and their settlements — so is set inactive instead. The
 * check is part of the delete, so an order given to the driver meanwhile
 * keeps them.
 */
export async function deleteDriver(db: AppDb, driverId: string): Promise<void> {
  const [result] = await db.batch([
    db
      .delete(drivers)
      .where(and(eq(drivers.id, driverId), notExists(db.select({ one: sql`1` }).from(shipments).where(eq(shipments.driverId, driverId))))),
  ]);
  if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) return;

  const held = await db
    .select({
      total: count(),
      open: sql<number>`coalesce(sum(case when ${shipments.deliveredAt} is null and ${shipments.returnedAt} is null and ${shipments.cancelledAt} is null then 1 else 0 end), 0)`,
    })
    .from(shipments)
    .where(eq(shipments.driverId, driverId))
    .get();
  const open = Number(held?.open ?? 0);
  if (open > 0) {
    throw new ConflictError(`The driver still has ${open} order(s) out; finish or take them back first`, ERROR_CODES.DRIVER_HAS_ACTIVE_ORDERS, {
      driverId,
      activeOrderCount: open,
    });
  }
  if (Number(held?.total ?? 0) > 0) {
    throw new ConflictError("The driver has past deliveries and settlements; set the driver inactive instead", ERROR_CODES.DRIVER_HAS_SHIPMENTS, {
      driverId,
      shipmentCount: Number(held?.total),
    });
  }
}
