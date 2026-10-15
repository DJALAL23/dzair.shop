import { tool } from "ai";
import { z } from "zod";
import type { AppDb } from "@/db";
import { toolOutput } from "@/lib/tool-output-schema";
import { getAllDeliveryCompanies } from "../../../../cod-shared/queries/delivery-companies";

/** Layer-2 validation schema, exported so src/mcp/schemas.ts advertises the very shape the tool validates. */
export const listDeliveryCompaniesSchema = z.object({
  active: z.boolean().optional().describe("Only active (true) or inactive (false) companies"),
});

export const DELIVERY_COMPANY_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  listDeliveryCompanies: listDeliveryCompaniesSchema.shape,
};

export const DELIVERY_COMPANY_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  listDeliveryCompanies: toolOutput({
    count: z.number().int(),
    companies: z.array(
      z.object({
        id: z.string().describe("What handOffOrderToCarrier takes as companyId"),
        name: z.string(),
        code: z.string(),
        provider: z.string().nullable().describe("The carrier platform; null = it cannot take parcels"),
        active: z.boolean(),
        isConnected: z.boolean().describe("Whether its API credentials are set — needed to hand it parcels"),
        supportsHomeDelivery: z.boolean(),
        supportsStopDesk: z.boolean(),
      }),
    ).describe("The store's delivery companies, newest first"),
  }),
};

/** AI tools for the store's delivery companies — what an order can be handed to. Credentials never leave the server. */
export const getDeliveryCompanyTools = (db: AppDb) => ({
  listDeliveryCompanies: tool({
    description:
      "List the store's delivery companies (carriers), to pick the companyId handOffOrderToCarrier takes. " +
      "A company takes parcels only when it is active, connected (isConnected) and has a provider. Optional: active (boolean).",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = listDeliveryCompaniesSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Expected: active (boolean, optional)` };
      }
      try {
        const companies = await getAllDeliveryCompanies(db, { active: parsed.data.active, limit: 100 });
        return {
          success: true,
          count: companies.length,
          companies: companies.map((c) => ({
            id: c.id,
            name: c.name,
            code: c.code,
            provider: c.provider,
            active: c.active,
            isConnected: c.isConnected,
            supportsHomeDelivery: c.supportsHomeDelivery,
            supportsStopDesk: c.supportsStopDesk,
          })),
        };
      } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
      }
    },
  }),
});
