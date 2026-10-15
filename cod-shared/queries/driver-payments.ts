/**
 * Driver settlement — the store and its driver squaring up for delivered
 * shipments (ADR 0006: settlement owns its links; a shipment holds no money
 * state).
 *
 * A payment settles parts of delivered driver shipments, each part once:
 *   cod_remittance — the driver hands over the cash collected (the `cod` part);
 *   fee_payment    — the store pays the driver's frozen fees (the `fee` part);
 *   net_settlement — both at once: the driver hands over the cash less the fees.
 * Each settled part is a `driver_payment_lines` row, UNIQUE(shipment, part),
 * written in the same batch as the payment and the driver's cash counters —
 * so two payments racing for the same shipment can never both settle it, and
 * a payment is never recorded without its lines.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { driverPaymentLines, driverPayments, drivers, orders, shipments } from "../db/schema";
import type { AppDb } from "../db/client";
import type { SettlementComponent } from "../shipments/model";
import { chunkIds } from "./d1-limits";

export const PAYMENT_TYPES = ["cod_remittance", "fee_payment", "net_settlement"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** The parts of a shipment each type of payment settles. */
export const PARTS_SETTLED: Record<PaymentType, readonly SettlementComponent[]> = {
  cod_remittance: ["cod"],
  fee_payment: ["fee"],
  net_settlement: ["cod", "fee"],
};

export interface PaymentRequest {
  driverId: string;
  type: PaymentType;
  shipmentIds: readonly string[];
  notes?: string | null;
}

export type DriverPaymentRow = typeof driverPayments.$inferSelect;

export type PaymentOutcome =
  | { ok: true; payment: DriverPaymentRow }
  /** Not this driver's, not a driver shipment, not delivered, or gone. */
  | { ok: false; reason: "not_settleable"; shipmentIds: string[] }
  | { ok: false; reason: "already_settled"; component: SettlementComponent; shipmentIds: string[] };

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Five bound values per line; D1 binds at most 100 per statement. */
const LINES_PER_INSERT = 18;
const ATTEMPTS = 3;

function constraintFailure(error: unknown): "unique" | "foreign_key" | null {
  const text = `${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  if (/UNIQUE constraint failed: driver_payment_lines/i.test(text)) return "unique";
  if (/FOREIGN KEY constraint failed/i.test(text)) return "foreign_key";
  return null;
}

/** The driver's delivered shipments among these ids. */
async function settleable(db: AppDb, driverId: string, ids: readonly string[]) {
  const rows = [];
  for (const chunk of chunkIds([...ids])) {
    rows.push(
      ...(await db
        .select({ id: shipments.id, codAmount: shipments.codAmount, driverFee: shipments.driverFee })
        .from(shipments)
        .where(and(inArray(shipments.id, chunk), eq(shipments.kind, "driver"), eq(shipments.driverId, driverId), isNotNull(shipments.deliveredAt)))
        .all()),
    );
  }
  return rows;
}

async function settledParts(db: AppDb, ids: readonly string[]) {
  const rows = [];
  for (const chunk of chunkIds([...ids])) {
    rows.push(
      ...(await db
        .select({ shipmentId: driverPaymentLines.shipmentId, component: driverPaymentLines.component })
        .from(driverPaymentLines)
        .where(inArray(driverPaymentLines.shipmentId, chunk))
        .all()),
    );
  }
  return rows;
}

/**
 * Record a payment settling these delivered shipments of the driver. The
 * amount is never taken from the caller: it is the shipments' frozen cash
 * and fees. Refused, with nothing recorded, when a shipment cannot be
 * settled or a part it would settle already is.
 */
export async function createDriverPayment(db: AppDb, request: PaymentRequest, by: { id: string; name: string }): Promise<PaymentOutcome> {
  const ids = [...new Set(request.shipmentIds)];
  const parts = PARTS_SETTLED[request.type];
  for (let attempt = 1; ; attempt++) {
    const rows = await settleable(db, request.driverId, ids);
    if (rows.length !== ids.length) {
      const found = new Set(rows.map((r) => r.id));
      return { ok: false, reason: "not_settleable", shipmentIds: ids.filter((id) => !found.has(id)) };
    }
    const taken = (await settledParts(db, ids)).filter((line) => parts.includes(line.component));
    if (taken.length > 0) {
      const component = taken[0].component;
      return { ok: false, reason: "already_settled", component, shipmentIds: taken.filter((t) => t.component === component).map((t) => t.shipmentId) };
    }

    const codTotal = rows.reduce((sum, r) => sum + r.codAmount, 0);
    const feeTotal = rows.reduce((sum, r) => sum + r.driverFee, 0);
    const amount = request.type === "cod_remittance" ? codTotal : request.type === "fee_payment" ? feeTotal : codTotal - feeTotal;
    const now = new Date().toISOString();
    const payment: DriverPaymentRow = {
      id: crypto.randomUUID(),
      driverId: request.driverId,
      type: request.type,
      amount,
      orderCount: rows.length,
      notes: request.notes ?? null,
      createdBy: by.id,
      createdByName: by.name,
      createdAt: now,
    };

    const lines = rows.flatMap((row) =>
      parts.map((component) => ({
        id: crypto.randomUUID(),
        paymentId: payment.id,
        shipmentId: row.id,
        component,
        amount: component === "cod" ? row.codAmount : row.driverFee,
      })),
    );
    const statements: BatchStatement[] = [db.insert(driverPayments).values(payment)];
    for (let start = 0; start < lines.length; start += LINES_PER_INSERT) {
      statements.push(db.insert(driverPaymentLines).values(lines.slice(start, start + LINES_PER_INSERT)));
    }
    if (parts.includes("cod")) {
      statements.push(
        db
          .update(drivers)
          .set({
            pendingCash: sql`MAX(0, ${drivers.pendingCash} - ${codTotal})`,
            totalPaid: sql`${drivers.totalPaid} + ${codTotal}`,
            updatedAt: now,
          })
          .where(eq(drivers.id, request.driverId)),
      );
    }

    try {
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
      return { ok: true, payment };
    } catch (error) {
      // Another payment settled one of them, or a shipment went, in between: decide again on what is there now.
      if (constraintFailure(error) === null || attempt >= ATTEMPTS) throw error;
    }
  }
}

/** A driver's payments, newest first. */
export function getDriverPayments(db: AppDb, driverId: string): Promise<DriverPaymentRow[]> {
  return db.select().from(driverPayments).where(eq(driverPayments.driverId, driverId)).orderBy(desc(driverPayments.createdAt)).all();
}

export interface PendingSettlement {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  codAmount: number;
  driverFee: number;
  deliveredAt: string;
  /** The payment that settled the cash, or null while the driver still holds it. */
  codPaymentId: string | null;
  /** The payment that settled the fee, or null while it is owed. */
  feePaymentId: string | null;
}

const settledBy = (component: SettlementComponent) =>
  sql<string | null>`(select ${driverPaymentLines.paymentId} from ${driverPaymentLines} where ${driverPaymentLines.shipmentId} = ${shipments.id} and ${driverPaymentLines.component} = ${component})`;

/** The driver's delivered shipments with a part still to settle — the cash, the fee, or both — newest delivery first. */
export async function getPendingSettlements(db: AppDb, driverId: string): Promise<PendingSettlement[]> {
  const cod = settledBy("cod");
  const fee = settledBy("fee");
  return db
    .select({
      shipmentId: shipments.id,
      orderId: shipments.orderId,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      codAmount: shipments.codAmount,
      driverFee: shipments.driverFee,
      deliveredAt: sql<string>`${shipments.deliveredAt}`,
      codPaymentId: cod,
      feePaymentId: fee,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(eq(shipments.kind, "driver"), eq(shipments.driverId, driverId), isNotNull(shipments.deliveredAt), sql`(${cod} is null or ${fee} is null)`))
    .orderBy(desc(shipments.deliveredAt))
    .all();
}
