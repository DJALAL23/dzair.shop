import { tool } from "ai";
import { z } from "zod";
import type { AppDb } from "@/db";
import type { Env } from "@/types/env";
import { agentActingOf, type McpProps } from "@/mcp/props";
import { scheduleShipmentConversions } from "@/lib/conversions";
import { toolOutput, timestampSchema } from "@/lib/tool-output-schema";
import { handOffOne } from "./handoff-results";
import { reportShipmentEvent } from "./operations";
import { loadShipmentView } from "./view";
import { carrierHandoffSchema, driverHandoffSchema, merchantReportSchema } from "./validation";

/**
 * Layer-2 validation schemas, exported so the MCP layer (src/mcp/schemas.ts)
 * advertises the very shapes the tools validate — the route bodies, plus the
 * order or shipment the route takes from its path.
 */
export const getShipmentSchema = z.object({
  shipmentId: z.string().min(1).describe("The shipment's id (an order's shipment.id)"),
});
export const handOffOrderToCarrierSchema = carrierHandoffSchema.omit({ kind: true }).extend({
  orderId: z.string().min(1).describe("The ready order to hand off"),
});
export const handOffOrderToDriverSchema = driverHandoffSchema.omit({ kind: true }).extend({
  orderId: z.string().min(1).describe("The ready order to give the driver"),
});
export const reportShipmentEventSchema = merchantReportSchema.extend({
  shipmentId: z.string().min(1).describe("The shipment the report is about"),
});

export const SHIPMENT_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  getShipment: getShipmentSchema.shape,
  handOffOrderToCarrier: handOffOrderToCarrierSchema.shape,
  handOffOrderToDriver: handOffOrderToDriverSchema.shape,
  reportShipmentEvent: reportShipmentEventSchema.shape,
};

const shipmentSchema = z.looseObject({
  id: z.string(),
  orderId: z.string(),
  kind: z.enum(["carrier", "driver"]).describe("A carrier company's parcel, or the store's own driver"),
  companyId: z.string().nullable(),
  carrierName: z.string().nullable().describe("The delivery company carrying it; null for the store's driver"),
  driverId: z.string().nullable(),
  handoffState: z.string().describe("submitting | accepted | unknown (the carrier did not say — resolve it, never hand off again)"),
  trackingNumber: z.string().nullable(),
  codAmount: z.number().describe("Cash to collect at the door (DZD)"),
  providerStatus: z.string().nullable().describe("The latest status as the carrier or the merchant reported it"),
  deliveredAt: timestampSchema.nullable(),
  returnedAt: timestampSchema.nullable(),
  attentionSince: timestampSchema.nullable().describe("Set while the delivery needs the merchant"),
  actions: z.array(z.string()).describe("What can be done to this shipment now"),
});

const handoffSchema = z.looseObject({
  orderId: z.string(),
  orderNumber: z.string(),
  outcome: z.enum(["accepted", "unknown"]).describe("unknown: the carrier did not confirm — the parcel may exist; never hand the order off again"),
  shipment: shipmentSchema,
});

const recordedSchema = {
  recorded: z.number().int().describe("Events newly recorded (0 when this was already known)"),
  duplicates: z.number().int(),
  reached: z.array(z.string()).describe("Milestones this report reached (delivered, returned…)"),
};

export const SHIPMENT_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  getShipment: toolOutput({ shipment: shipmentSchema.describe("The shipment with its full history (events) and the actions open now") }),
  handOffOrderToCarrier: toolOutput({ handoff: handoffSchema, message: z.string() }),
  handOffOrderToDriver: toolOutput({ handoff: handoffSchema, message: z.string() }),
  reportShipmentEvent: toolOutput({ shipment: shipmentSchema, ...recordedSchema, message: z.string() }),
};

function invalid(error: z.ZodError, expected: string) {
  return { success: false as const, error: `Invalid arguments: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Expected: ${expected}` };
}

const failure = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) });

/**
 * AI tools for an order's delivery (ADR 0006): an order's delivery is its
 * shipment — a carrier company's parcel, or the store's own driver. These
 * run the routes' own paths (`POST /orders/{id}/shipment`,
 * `GET /shipments/{id}`, `POST /shipments/{id}/events`), as the person who
 * granted the access: a carrier's shipment is dispatch work, a driver's is
 * assignment work.
 */
export const getShipmentTools = (db: AppDb, env: Env, props: McpProps) => ({
  getShipment: tool({
    description:
      "Fetch a shipment: its carrier or driver, tracking number, cash to collect, every status the carrier or the merchant " +
      "reported with what CodFlow concluded (events), its milestones (delivered, returned…), whether it needs attention, " +
      "and the actions open now. An order's shipment id is in getOrderDetails (shipment.id).",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = getShipmentSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "shipmentId (string)");
      try {
        return { success: true, shipment: await loadShipmentView(db, parsed.data.shipmentId, { events: true }) };
      } catch (error) {
        return failure(error);
      }
    },
  }),

  handOffOrderToCarrier: tool({
    description:
      "Hand a ready order to a delivery company: the carrier creates the parcel, and the order's delivery is then its shipment. " +
      "Required: orderId, companyId (listDeliveryCompanies). " +
      "Optional: deliveryType (home|stop_desk, instead of what the customer chose), stationCode (the stop desk), weight (kg), fragile, remarks (for the courier). " +
      "Outcome accepted: the parcel exists. Outcome unknown: the carrier did not confirm — the parcel may exist, so NEVER hand the order off again; " +
      "the merchant resolves it from the shipment. Refused when the order is not ready or already has a shipment.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = handOffOrderToCarrierSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "orderId, companyId; optional deliveryType (home|stop_desk), stationCode, weight (kg > 0), fragile, remarks");
      const { orderId, ...request } = parsed.data;
      try {
        const handoff = await handOffOne(db, orderId, { kind: "carrier", ...request }, agentActingOf(props));
        const message = handoff.outcome === "accepted"
          ? `Order ${handoff.orderNumber} handed to the carrier${handoff.shipment?.trackingNumber ? `, tracking ${handoff.shipment.trackingNumber}` : ""}`
          : `The carrier did not confirm order ${handoff.orderNumber}'s parcel. Do not hand it off again: the merchant resolves it from the shipment.`;
        return { success: true, handoff, message };
      } catch (error) {
        return failure(error);
      }
    },
  }),

  handOffOrderToDriver: tool({
    description:
      "Give a ready order to one of the store's own drivers: the shipment is accepted at once, with the driver's fee for the wilaya fixed. " +
      "The driver delivers to the customer's street address — never to a stop desk, even when the customer chose one (the order keeps its price). " +
      "Required: orderId, driverId (listDrivers). " +
      "Refused when the order is not ready, already has a shipment, has no street address, or the driver is inactive. " +
      "Report the driver's progress with reportShipmentEvent.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = handOffOrderToDriverSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "orderId, driverId");
      const { orderId, ...request } = parsed.data;
      try {
        const handoff = await handOffOne(db, orderId, { kind: "driver", ...request }, agentActingOf(props));
        return { success: true, handoff, message: `Order ${handoff.orderNumber} given to the driver` };
      } catch (error) {
        return failure(error);
      }
    },
  }),

  reportShipmentEvent: tool({
    description:
      "Record what happened to a delivery, as the merchant saw it. On a driver's shipment: out_for_delivery, failed_attempt, delivered (the driver collected the cash), " +
      "or returned (the goods are back; the order is restocked). On a carrier's shipment only returned: the goods are back with the merchant — " +
      "the carrier alone says a parcel was delivered. Required: shipmentId, status. Optional: reason, occurredAt (ISO time between the handoff and now). " +
      "Refused once the shipment is closed (delivered, returned or cancelled). The same report with the same occurredAt is recorded once.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = reportShipmentEventSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "shipmentId, status (out_for_delivery|failed_attempt|delivered|returned); optional reason, occurredAt (ISO)");
      const { shipmentId, ...report } = parsed.data;
      try {
        const recorded = await reportShipmentEvent(db, shipmentId, report, agentActingOf(props));
        const scheduled: Promise<unknown>[] = [];
        await scheduleShipmentConversions(env, (p) => void scheduled.push(p), db, recorded.businessEvents);
        await Promise.allSettled(scheduled);
        return {
          success: true,
          shipment: await loadShipmentView(db, shipmentId, { events: false }),
          recorded: recorded.recorded,
          duplicates: recorded.duplicates,
          reached: recorded.reached,
          message: recorded.recorded ? `Recorded: ${report.status}` : `Already recorded: ${report.status}`,
        };
      } catch (error) {
        return failure(error);
      }
    },
  }),
});
