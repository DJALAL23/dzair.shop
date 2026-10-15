/**
 * Driver Payments Routes
 *
 * Records payments that settle a driver's delivered shipments (COD
 * remittance, fee payment, or net settlement) and lists what is still to
 * settle.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as handlers from "./handlers";
import { createPaymentSchema } from "./validation";
import {
  DriverPaymentSchema,
  PendingSettlementSchema,
  SuccessWithMessageSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const driverIdParams = z.object({
  driverId: z.string().openapi({ description: "UUID of the driver" }),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const createPaymentRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Driver Payments"],
  summary: "Create driver payment",
  description: `Record a payment that settles delivered shipments of one driver. Each shipment has two parts to settle, once each: the **cash** the driver collected and the driver's **fee**.

- \`cod_remittance\` — the driver hands over the cash: settles the cash part; the driver's \`pendingCash\` drops and \`totalPaid\` rises by the cash total.
- \`fee_payment\` — the store pays the driver's fees: settles the fee part; the cash counters do not move.
- \`net_settlement\` — both at once: the driver hands over the cash less the fees.

**The amount is computed, never sent:** the shipments' frozen \`codAmount\` and \`driverFee\` give \`sum(codAmount)\`, \`sum(driverFee)\` or their difference. The payment, its lines and the driver's counters are one atomic write; a part already settled — even by a payment recorded at the same moment — refuses the whole payment.

\`createdBy\` and \`createdByName\` come from the authenticated user.`,
  operationId: "createDriverPayment",
  body: createPaymentSchema,
  responses: {
    201: {
      description: "Payment recorded. Returns the new payment record.",
      content: jsonContent(SuccessWithMessageSchema(DriverPaymentSchema)),
    },
    422: {
      description: `Nothing was recorded. Distinguish via \`code\`:
- \`SHIPMENT_NOT_SETTLEABLE\` — a shipment is not one of this driver's delivered shipments (\`context.shipmentIds\`)
- \`PAYMENT_ALREADY_SETTLED\` — a part this payment settles already is (\`context.kind\`: \`"cod"\` or \`"fee"\`; \`context.shipmentIds\`)`,
    },
  },
  handler: handlers.createPayment,
});

const listPaymentsRoute = defineRoute({
  method: "get",
  path: "/{driverId}",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Driver Payments"],
  summary: "List driver payment history",
  description: "All payment records of a driver, newest first; an empty array when there are none or the driver does not exist.",
  operationId: "listDriverPayments",
  params: driverIdParams,
  responses: {
    200: {
      description: "Payment history",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }), data: z.array(DriverPaymentSchema) })),
    },
  },
  handler: handlers.listPayments,
});

const listPendingRoute = defineRoute({
  method: "get",
  path: "/{driverId}/pending",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Driver Payments"],
  summary: "List shipments awaiting settlement",
  description: "The driver's delivered shipments with a part still to settle — the cash (\`codPaymentId\` null), the fee (\`feePaymentId\` null), or both — newest delivery first. Use it to prepare a payment.",
  operationId: "listPendingSettlements",
  params: driverIdParams,
  responses: {
    200: {
      description: "Shipments awaiting settlement (empty array when none)",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }), data: z.array(PendingSettlementSchema) })),
    },
  },
  handler: handlers.listPending,
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new OpenAPIHono<AppContext>();

router.openapi(createPaymentRoute.route, createPaymentRoute.handler);
router.openapi(listPaymentsRoute.route, listPaymentsRoute.handler);
router.openapi(listPendingRoute.route, listPendingRoute.handler);

export default router;
