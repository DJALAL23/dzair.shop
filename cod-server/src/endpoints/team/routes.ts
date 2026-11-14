/**
 * The confirmation team (cod-shared/team): who takes orders and who is
 * receiving them, how the store shares new orders out, each member's results,
 * and — with the finance permission — their pay and the month's payroll.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { MessageResponseSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { MemberResultsSchema, PayRateSchema, PayrollLineSchema, TeamCandidateSchema, TeamConfigSchema, TeamMemberSchema, TeamMembershipSchema, TeamOverviewSchema } from "@/openapi/schemas/team";
import * as h from "./handlers";
import * as v from "./validation";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const TAGS = ["Confirmation team"];

const routes = [
  defineRoute({
    method: "get",
    path: "/members",
    auth: { scope: SCOPES.TEAM_READ },
    tags: TAGS,
    summary: "List the confirmation team",
    description: "Each member, whether they are receiving new orders, how many orders still wait with them, and which orders their permissions let them work; with the new orders that are with nobody, those waiting for a manager, and those still waiting with someone who left the team or whose account is inactive.",
    operationId: "listTeamMembers",
    responses: { 200: { description: "The team", content: json(SuccessResponseSchema(TeamOverviewSchema)) } },
    handler: h.listMembers,
  }),
  defineRoute({
    method: "get",
    path: "/candidates",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "List who can join the confirmation team",
    description: "The store's active people who are not on the team yet, each with which orders their permissions let them work.",
    operationId: "listTeamCandidates",
    responses: { 200: { description: "The people", content: json(SuccessResponseSchema(z.array(TeamCandidateSchema))) } },
    handler: h.listCandidates,
  }),
  defineRoute({
    method: "post",
    path: "/members",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "Add a member to the confirmation team",
    description: "A staff member or an admin. Receiving from now on (the default), they are given new orders by the store's rule, starting with the orders that waited for someone. To work their orders they need `orders:read_assigned` (only theirs) or `orders:read` (every order).",
    operationId: "addTeamMember",
    body: v.addMemberSchema,
    responses: {
      201: { description: "The member", content: json(SuccessResponseSchema(TeamMemberSchema)) },
      404: { description: "No such user (USER_NOT_FOUND)" },
      409: { description: "Already on the team (ALREADY_TEAM_MEMBER)" },
    },
    handler: h.addMember,
  }),
  defineRoute({
    method: "patch",
    path: "/members/{userId}",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "Start or stop a member receiving new orders",
    description: "Starting gives them the orders that waited for someone, by the store's rule. The orders already with them stay with them either way.",
    operationId: "updateTeamMember",
    params: v.userIdParams,
    body: v.receivingSchema,
    responses: { 200: { description: "The member", content: json(SuccessResponseSchema(TeamMemberSchema)) }, 422: { description: "Not on the team (NOT_TEAM_MEMBER)" } },
    handler: h.updateMember,
  }),
  defineRoute({
    method: "delete",
    path: "/members/{userId}",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "Take a member off the confirmation team",
    description: "They receive nothing more. The orders still waiting with them (new, or the customer not reached) go back to the team by the store's rule; under `manual`, a manager gives them to someone (`POST /api/orders/assign`). The orders they confirmed stay theirs, and their pay is kept for past months' payroll.",
    operationId: "removeTeamMember",
    params: v.userIdParams,
    responses: { 200: { description: "Removed", content: json(MessageResponseSchema) }, 422: { description: "Not on the team (NOT_TEAM_MEMBER)" } },
    handler: h.removeMember,
  }),
  defineRoute({
    method: "get",
    path: "/me",
    auth: "api-key",
    tags: TAGS,
    summary: "Whether I am on the confirmation team",
    operationId: "getMyTeamMembership",
    responses: { 200: { description: "The caller's membership", content: json(SuccessResponseSchema(TeamMembershipSchema)) } },
    handler: h.myMembership,
  }),
  defineRoute({
    method: "put",
    path: "/me/receiving",
    auth: "api-key",
    tags: TAGS,
    summary: "Start or stop receiving new orders myself",
    description: "For a member of the team: the start and end of their shift. Starting gives them the orders that waited for someone, by the store's rule.",
    operationId: "setMyReceiving",
    body: v.receivingSchema,
    responses: { 200: { description: "The caller's membership", content: json(SuccessResponseSchema(TeamMembershipSchema)) }, 422: { description: "Not on the team (NOT_TEAM_MEMBER)" } },
    handler: h.setMyReceiving,
  }),
  defineRoute({
    method: "get",
    path: "/settings",
    auth: { scope: SCOPES.TEAM_READ },
    tags: TAGS,
    summary: "How new orders are shared out",
    operationId: "getTeamSettings",
    responses: { 200: { description: "The store's rule", content: json(SuccessResponseSchema(TeamConfigSchema)) } },
    handler: h.getSettings,
  }),
  defineRoute({
    method: "put",
    path: "/settings",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "Change how new orders are shared out",
    description: "By hand, in turn, or evenly; and whether an order a member leaves untouched moves on. Turning a rule on shares out the orders that waited for someone.",
    operationId: "updateTeamSettings",
    body: v.teamConfigSchema,
    responses: { 200: { description: "The store's rule", content: json(SuccessResponseSchema(TeamConfigSchema)) } },
    handler: h.updateSettings,
  }),
  defineRoute({
    method: "post",
    path: "/share-out",
    auth: { scope: SCOPES.TEAM_MANAGE },
    tags: TAGS,
    summary: "Share out the orders nobody is working, now",
    description: "Gives out, by the store's rule, new orders with nobody and orders still waiting with someone who left the team, oldest first, up to 50 at a time (the schedule goes on every five minutes). Under `manual`, or with nobody receiving, nothing moves.",
    operationId: "shareOutTeamOrders",
    responses: { 200: { description: "How many orders were given out", content: json(SuccessResponseSchema(z.object({ shared: z.number().int() }))) } },
    handler: h.shareOut,
  }),
  defineRoute({
    method: "get",
    path: "/results",
    auth: { scope: SCOPES.TEAM_READ },
    tags: TAGS,
    summary: "Each member's results",
    description: "For the orders placed in the period (store days, Algeria) and with each member now: how many were confirmed, cancelled, delivered and returned, the confirmation rate (orders still waiting left out), the delivery rate, and the average minutes to a first decision.",
    operationId: "getTeamResults",
    query: v.resultsQuerySchema,
    responses: { 200: { description: "One row per member with orders in the period", content: json(SuccessResponseSchema(z.array(MemberResultsSchema))) } },
    handler: h.results,
  }),
  defineRoute({
    method: "get",
    path: "/members/{userId}/pay",
    auth: { scope: SCOPES.FINANCE_READ },
    tags: TAGS,
    summary: "A member's pay rates",
    operationId: "listTeamMemberPay",
    params: v.userIdParams,
    responses: { 200: { description: "Each kind's rates, newest first", content: json(SuccessResponseSchema(z.array(PayRateSchema))) } },
    handler: h.listPay,
  }),
  defineRoute({
    method: "post",
    path: "/members/{userId}/pay",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Set a pay rate from a date",
    description: "A monthly salary, or an amount per order confirmed or per confirmed order delivered. It applies from its day on; earlier months keep the rates they had. Set for anyone who is or was on the team, so a past month can still be corrected after they leave.",
    operationId: "setTeamMemberPay",
    params: v.userIdParams,
    body: v.payRateSchema,
    responses: { 200: { description: "The rate", content: json(SuccessResponseSchema(PayRateSchema)) }, 422: { description: "Never on the team (NOT_TEAM_MEMBER)" } },
    handler: h.setPay,
  }),
  defineRoute({
    method: "delete",
    path: "/pay/{id}",
    auth: { scope: SCOPES.FINANCE_MANAGE },
    tags: TAGS,
    summary: "Remove a pay rate entered by mistake",
    operationId: "removeTeamPay",
    params: v.payIdParams,
    responses: { 200: { description: "Removed", content: json(MessageResponseSchema) }, 404: { description: "No such rate (PAY_RATE_NOT_FOUND)" } },
    handler: h.removePay,
  }),
  defineRoute({
    method: "get",
    path: "/payroll",
    auth: { scope: SCOPES.FINANCE_READ },
    tags: TAGS,
    summary: "A month's payroll",
    description: "Each member's salary in force at the month's end, plus their commission on the orders they confirmed that month and on those delivered that month, each at the rate in force that day. What has no rate is counted apart and named, never as zero.",
    operationId: "getTeamPayroll",
    query: v.payrollQuerySchema,
    responses: { 200: { description: "One line per member", content: json(SuccessResponseSchema(z.array(PayrollLineSchema))) } },
    handler: h.payroll,
  }),
];

const router = new OpenAPIHono<AppContext>();
for (const route of routes) router.openapi(route.route, route.handler);

export default router;
