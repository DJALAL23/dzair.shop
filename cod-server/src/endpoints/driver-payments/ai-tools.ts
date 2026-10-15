import { tool } from "ai";
import { z } from "zod";
import { createDriverPayment, getDriverPayments, getPendingSettlements } from "../../../../cod-shared/queries/driver-payments";
import { paymentRefusal } from "./refusals";
import { createPaymentSchema } from "./validation";
import type { AppDb } from "@/db";
import { actorOf, type McpProps } from "@/mcp/props";
import { toolOutput, timestampSchema } from "@/lib/tool-output-schema";

/**
 * Layer-2 validation schemas, hoisted to module level and exported so the MCP
 * layer (src/mcp/schemas.ts) can derive tools/list inputSchema from the exact
 * same definitions — the advertised schema and the executed validation cannot
 * drift apart.
 */
export const listDriverPaymentsSchema = z.object({
  driverId: z.string().uuid().describe("The unique UUID of the driver to retrieve payments for"),
});
export const getPendingSettlementsSchema = z.object({
  driverId: z.string().uuid().describe("The unique UUID of the driver"),
});
export const createDriverSettlementSchema = createPaymentSchema;

export const DRIVER_PAYMENT_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  listDriverPayments: listDriverPaymentsSchema.shape,
  getPendingSettlements: getPendingSettlementsSchema.shape,
  createDriverSettlement: createDriverSettlementSchema.shape,
};

export const DRIVER_PAYMENT_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  listDriverPayments: toolOutput({
    count: z.number().int(),
    payments: z.array(
      z.looseObject({
        id: z.string().describe("Payment record UUID"),
        type: z.string().describe("Settlement type (COD remittance, fee payment, or net settlement)"),
        amount: z.number().describe("Server-computed settlement amount in DZD"),
        orderCount: z.number().int().describe("Shipments settled in this payment"),
        createdAt: timestampSchema,
        createdByName: z.string().describe("Who created the settlement (audit attribution)"),
        notes: z.string().nullable(),
      }),
    ).describe("Settlement history, newest first"),
  }),
  getPendingSettlements: toolOutput({
    count: z.number().int(),
    shipments: z.array(
      z.looseObject({
        shipmentId: z.string().describe("Shipment UUID — what a settlement lists"),
        orderNumber: z.string(),
        codAmount: z.number().describe("Cash the driver collected (DZD)"),
        driverFee: z.number().describe("The driver's frozen fee (DZD)"),
        deliveredAt: timestampSchema,
        cashSettled: z.boolean().describe("Whether the driver has handed over the cash"),
        feeSettled: z.boolean().describe("Whether the store has paid the fee"),
      }),
    ).describe("Delivered shipments with the cash, the fee, or both still to settle"),
  }),
  createDriverSettlement: toolOutput({
    settlement: z.looseObject({
      type: z.string().optional().describe("Settlement type"),
      orderCount: z.number().int().optional().describe("Shipments settled"),
      amount: z.number().optional().describe("Settled amount in DZD"),
    }).describe("The created payment record"),
    message: z.string(),
  }),
};

/**
 * AI Tools for Driver Payment Management
 * 
 * These tools allow the AI Agent to interact directly with the driver payments
 * and settlement logic.
 * 
 * Two-Layer Validation Pattern:
 * - Layer 1 (LLM-level): Permissive input schema accepts any object to prevent SDK crashes
 * - Layer 2 (App-level): Strict validation inside execute() with graceful error handling
 * 
 * This ensures the AI agent can recover from validation errors without breaking the conversation.
 */
export const getDriverPaymentTools = (db: AppDb, props: McpProps) => ({
  listDriverPayments: tool({
    description: "Fetch all settlement and payment records for a specific driver. Returns history of COD remittances, fee payments, and net settlements.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      // Layer 2: Strict validation
      const validationSchema = listDriverPaymentsSchema;
      
      const parsed = validationSchema.safeParse(args);
      
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: driverId (UUID string)`,
        };
      }

      try {
        const payments = await getDriverPayments(db, parsed.data.driverId);
        return { 
          success: true,
          count: payments.length,
          payments: payments.map(p => ({
            id: p.id,
            type: p.type,
            amount: p.amount,
            orderCount: p.orderCount,
            createdAt: p.createdAt,
            createdByName: p.createdByName,
            notes: p.notes
          }))
        };
      } catch (error: any) {
        return { 
          success: false, 
          error: `Database error: ${error.message}` 
        };
      }
    },
  }),

  getPendingSettlements: tool({
    description: "Finds a driver's delivered shipments whose cash or fee is not settled yet. Use this to prepare a payment: pass their shipmentId values to createDriverSettlement.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      // Layer 2: Strict validation
      const validationSchema = getPendingSettlementsSchema;
      
      const parsed = validationSchema.safeParse(args);
      
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: driverId (UUID string)`,
        };
      }

      try {
        const pending = await getPendingSettlements(db, parsed.data.driverId);
        return {
          success: true,
          count: pending.length,
          shipments: pending.map((p) => ({
            shipmentId: p.shipmentId,
            orderNumber: p.orderNumber,
            codAmount: p.codAmount,
            driverFee: p.driverFee,
            deliveredAt: p.deliveredAt,
            cashSettled: p.codPaymentId !== null,
            feeSettled: p.feePaymentId !== null,
          })),
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Database error: ${error.message}`
        };
      }
    },
  }),

  createDriverSettlement: tool({
    description: "Records a payment settling a driver's delivered shipments. Required: driverId (UUID), type (cod_remittance: the driver hands over the cash | fee_payment: the store pays the fees | net_settlement: both), shipmentIds (from getPendingSettlements). Optional: notes. The amount is computed from the shipments; a part already settled refuses the whole payment. Recorded as made by the person who granted the access.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      // Layer 2: Strict validation
      const validationSchema = createDriverSettlementSchema;
      
      const parsed = validationSchema.safeParse(args);
      
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        return {
          success: false,
          error: `Invalid settlement data: ${errorDetails}. Required: driverId (UUID), type (cod_remittance|fee_payment|net_settlement), shipmentIds (array, min 1, no repeats). Optional: notes (string).`,
        };
      }

      try {
        const outcome = await createDriverPayment(db, parsed.data, actorOf(props));
        if (!outcome.ok) return { success: false, error: paymentRefusal(outcome, parsed.data.driverId).message };
        return {
          success: true,
          settlement: outcome.payment,
          message: `Settlement created: ${outcome.payment.type} for ${outcome.payment.orderCount} shipment(s), amount: ${outcome.payment.amount} DZD`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),
});
