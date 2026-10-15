/**
 * Analytics Routes
 *
 * Read-only endpoints that serve aggregated stats for the dashboard and
 * any future reporting features. Protected by DASHBOARD_VIEW scope.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { getDashboardStats, getOrderStages } from "./handlers";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { OrderStatusEnum } from "@/openapi/schemas";

const dashboardStatsRoute = defineRoute({
  method: "get",
  path: "/dashboard-stats",
  auth: { scope: SCOPES.DASHBOARD_VIEW },
  tags: ["Analytics"],
  summary: "Order status statistics",
  description:
    "Returns order counts grouped by lifecycle status in a single optimized query — powers the dashboard summary cards.",
  operationId: "getDashboardStats",
  responses: {
    200: {
      description: "Order counts per status",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().openapi({ example: true }),
            data: z.array(
              z.object({
                status: OrderStatusEnum,
                count: z.number().int().openapi({ example: 12 }),
              })
            ),
          }),
        },
      },
    },
  },
  handler: getDashboardStats,
});

const orderStagesRoute = defineRoute({
  method: "get",
  path: "/order-stages",
  auth: { scope: SCOPES.DASHBOARD_VIEW },
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

const router = new OpenAPIHono<AppContext>();

router.openapi(dashboardStatsRoute.route, dashboardStatsRoute.handler);
router.openapi(orderStagesRoute.route, orderStagesRoute.handler);

export default router;
