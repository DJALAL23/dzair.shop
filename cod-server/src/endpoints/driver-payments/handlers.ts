import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import {
  createDriverPayment,
  getDriverPayments,
  getPendingSettlements,
} from "../../../../cod-shared/queries/driver-payments";
import { paymentRefusal } from "./refusals";
import type { CreatePaymentInput } from "./validation";

/** POST /api/driver-payments — record a payment settling delivered driver shipments. */
export async function createPayment(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as CreatePaymentInput;
  const user = c.get("user");
  const outcome = await createDriverPayment(db, body, { id: user.id, name: user.name ?? user.id });
  if (!outcome.ok) throw paymentRefusal(outcome, body.driverId);
  console.info(`[driver-payments] type=${body.type} driver=${body.driverId} amount=${outcome.payment.amount} shipments=${outcome.payment.orderCount} by="${user.name ?? user.id}"`);
  return c.json({ success: true, data: outcome.payment, message: "Payment recorded successfully" }, 201);
}

/** GET /api/driver-payments/{driverId} — the driver's payments, newest first. */
export async function listPayments(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getDriverPayments(db, c.req.param("driverId")!) }, 200);
}

/** GET /api/driver-payments/{driverId}/pending — delivered shipments with a part still to settle. */
export async function listPending(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getPendingSettlements(db, c.req.param("driverId")!) }, 200);
}
