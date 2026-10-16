/**
 * Analytics Routes
 *
 * Read-only endpoints that serve aggregated stats for the dashboard and
 * any future reporting features.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { getOrderActivityStats, getOrderStages } from "./handlers";
import { ACTIVITY_WINDOWS } from "../../../../cod-shared/queries/analytics";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";

const orderStagesRoute = defineRoute({
  method: "get",
  path: "/order-stages",
  auth: { anyOf: [SCOPES.DASHBOARD_VIEW, SCOPES.ORDERS_READ] },
  tags: ["Analytics"],
  summary: "Orders by stage",
  description:
    "Orders counted by the stage the merchant sees — their processing, then their shipment's delivery (the same stage as `GET /api/orders/{id}`) — with only the stages that have orders, and how many orders need the merchant's attention (an unknown handoff, a parcel the carrier cancelled or flagged).",
  operationId: "getOrderStageStats",
  responses: {
    200: {
      description: "Orders per stage, and the count needing attention",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().openapi({ example: true }),
            data: z.object({
              stages: z.array(z.object({ stage: z.enum(ORDER_STAGES), count: z.number().int().openapi({ example: 12 }) })),
              needsAttention: z.number().int().openapi({ example: 3 }),
            }),
          }),
        },
      },
    },
  },
  handler: getOrderStages,
});

const activityDay = z.object({
  date: z.string().openapi({ example: "2026-10-16" }),
  orders: z.number().int().openapi({ example: 14 }),
  sales: z.number().openapi({ example: 52400 }),
});

const orderActivityRoute = defineRoute({
  method: "get",
  path: "/order-activity",
  auth: { anyOf: [SCOPES.DASHBOARD_VIEW, SCOPES.ORDERS_READ] },
  tags: ["Analytics"],
  summary: "Orders placed per day",
  description:
    "Orders placed per store day (Algeria, UTC+1) over the last `days` days, today included, and what they are worth (price plus delivery fee), with the totals of the same number of days just before for comparison. Cancelled orders are left out. Only days with orders appear.",
  operationId: "getOrderActivity",
  query: z.object({
    days: z
      .enum(ACTIVITY_WINDOWS.map(String) as ["7", "30", "90"])
      .default("30")
      .transform(Number)
      .openapi({ description: "How many days the window spans", example: "30" }),
  }),
  responses: {
    200: {
      description: "Orders and sales per day, and the previous window's totals",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().openapi({ example: true }),
            data: z.object({
              from: z.string().openapi({ example: "2026-09-17" }),
              to: z.string().openapi({ example: "2026-10-16" }),
              days: z.array(activityDay),
              previous: z.object({ orders: z.number().int(), sales: z.number() }),
            }),
          }),
        },
      },
    },
  },
  handler: getOrderActivityStats,
});

const router = new OpenAPIHono<AppContext>();

router.openapi(orderStagesRoute.route, orderStagesRoute.handler);
router.openapi(orderActivityRoute.route, orderActivityRoute.handler);

export default router;
