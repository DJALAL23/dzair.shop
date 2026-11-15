/**
 * The store's own costs (cod-shared/finance): ads, packaging, calls, rent
 * and subscriptions, once, repeating or per order; what they come to over a
 * period; and the exchange rates foreign costs are counted at. Reading takes
 * finance:read, changing finance:manage.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { MessageResponseSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { CostSchema, CostsSummarySchema, ExchangeRateSchema } from "@/openapi/schemas/finance";
import * as h from "./handlers";
import * as v from "./validation";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const TAGS = ["Finance"];

const routes = [
  defineRoute({
    method: "get",
    path: "/costs",
    auth: { scope: SCOPES.FINANCE_READ },
    tags: TAGS,
    summary: "List the store's costs",
    description: "Every cost the merchant entered, with its amount in force and the amounts it had before.",
    operationId: "listCosts",
    responses: { 200: { description: "The costs, by name", content: json(SuccessResponseSchema(z.array(CostSchema))) } },
    handler: h.listCosts,
  }),
  defineRoute({
    method: "get",
    path: "/costs/summary",
    auth: { scope: SCOPES.FINANCE_READ },
    tags: TAGS,
    summary: "What the costs come to over a period",
    description:
      "In dinars, over store days (Algeria): a one-time cost on its day, a repeating one spread over each day it runs, a per-order one on each order its event touched. A foreign cost takes the rate in force each day; a day without one is left out and named in `missing`, never guessed.",
    operationId: "getCostsSummary",
    query: v.summaryQuerySchema,
    responses: { 200: { description: "Totals and each cost's part", content: json(SuccessResponseSchema(CostsSummarySchema)) } },
    handler: h.costsSummary,
  }),
  defineRoute({
    method: "post",
    path: "/costs",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Add a cost",
    operationId: "createCost",
    body: v.costSchema,
    responses: { 201: { description: "The cost", content: json(SuccessResponseSchema(CostSchema)) }, 404: { description: "No such product (PRODUCT_NOT_FOUND)" } },
    handler: h.createCost,
  }),
  defineRoute({
    method: "put",
    path: "/costs/{id}",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Change a cost",
    description:
      "Its name, category and product are corrected everywhere. A new amount, currency or charge with `changeFrom` after the day its amount in force started applies from that day: the days before keep what they cost. Without it, the change corrects the cost from its start.",
    operationId: "updateCost",
    params: v.idParams,
    body: v.costUpdateSchema,
    responses: {
      200: { description: "The cost", content: json(SuccessResponseSchema(CostSchema)) },
      404: { description: "No such cost (COST_NOT_FOUND) or product (PRODUCT_NOT_FOUND)" },
      422: { description: "A cost with earlier amounts made one-time or the reverse (COST_HAS_HISTORY), or days that do not follow on (COST_DATES_INVALID)" },
    },
    handler: h.updateCost,
  }),
  defineRoute({
    method: "delete",
    path: "/costs/{id}",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Delete a cost entered by mistake",
    description: "Removes it and every amount it had, from every period. To stop a cost that really ran, give it a last day instead.",
    operationId: "deleteCost",
    params: v.idParams,
    responses: { 200: { description: "Removed", content: json(MessageResponseSchema) }, 404: { description: "No such cost (COST_NOT_FOUND)" } },
    handler: h.deleteCost,
  }),
  defineRoute({
    method: "get",
    path: "/rates",
    auth: { scope: SCOPES.FINANCE_READ },
    tags: TAGS,
    summary: "List the exchange rates",
    operationId: "listExchangeRates",
    responses: { 200: { description: "Each currency's rates, newest first", content: json(SuccessResponseSchema(z.array(ExchangeRateSchema))) } },
    handler: h.listRates,
  }),
  defineRoute({
    method: "post",
    path: "/rates",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Set what a currency costs from a day",
    description: "What one dollar or euro costs the merchant in dinars, from a store day on. Days before keep the rate they had. There is no default rate.",
    operationId: "setExchangeRate",
    body: v.rateSchema,
    responses: { 200: { description: "The rate", content: json(SuccessResponseSchema(ExchangeRateSchema)) } },
    handler: h.setRate,
  }),
  defineRoute({
    method: "delete",
    path: "/rates/{id}",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Remove an exchange rate entered by mistake",
    operationId: "removeExchangeRate",
    params: v.idParams,
    responses: { 200: { description: "Removed", content: json(MessageResponseSchema) }, 404: { description: "No such rate (EXCHANGE_RATE_NOT_FOUND)" } },
    handler: h.removeRate,
  }),
];

const router = new OpenAPIHono<AppContext>();
for (const route of routes) router.openapi(route.route, route.handler);

export default router;
