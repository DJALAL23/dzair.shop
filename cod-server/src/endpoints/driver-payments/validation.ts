import { z } from "zod";
import { PAYMENT_TYPES } from "../../../../cod-shared/queries/driver-payments";

export const createPaymentSchema = z.object({
  driverId: z.string().min(1).describe("The UUID of the driver receiving or making the payment"),
  type: z
    .enum(PAYMENT_TYPES)
    .describe(
      "'cod_remittance' (the driver hands over the cash collected), 'fee_payment' (the store pays the driver's fees), or 'net_settlement' (both at once: the cash less the fees)",
    ),
  shipmentIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one shipment")
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "A shipment is listed twice")
    .describe("The driver's delivered shipments this payment settles"),
  notes: z.string().optional().describe("Internal notes about this payment record"),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
