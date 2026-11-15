/**
 * The confirmation team's handlers: its members and who is receiving, how
 * the store shares orders out, giving orders out and taking them back, a
 * customer's callback, results, pay and payroll.
 */

import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { logActivity, ACTIONS } from "@/lib/activity";
import { hiddenOrderIds } from "@/lib/order-visibility";
import { BusinessLogicError, ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { assignOrders, shareOutWaiting } from "../../../../cod-shared/team/assign";
import * as team from "../../../../cod-shared/team/queries";
import { setCallback as setCallbackTime } from "../../../../cod-shared/team/callbacks";
import type { Author } from "../../../../cod-shared/events/actor";
import type * as v from "./validation";

const valid = <T>(c: Context<AppContext>, target: "json" | "query" | "param") => (c.req as unknown as { valid: (t: string) => T }).valid(target);

/** The store's rule as the author of what it shares out, through the surface the change came from. */
const ruleOf = (c: Context<AppContext>): Author => ({ actor: { kind: "system", id: null, name: null }, origin: c.get("author").origin });

const membershipRefusal = (reason: "user_not_found" | "already_member" | "not_member", userId: string) => {
  if (reason === "user_not_found") return new NotFoundError("User", userId);
  if (reason === "already_member") return new ConflictError("This member is already on the confirmation team", ERROR_CODES.ALREADY_TEAM_MEMBER, { userId });
  return new BusinessLogicError("This person is not on the confirmation team", ERROR_CODES.NOT_TEAM_MEMBER, { userId });
};

/** GET /team/members */
export async function listMembers(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const [members, queue] = await Promise.all([team.listTeamMembers(db), team.teamQueue(db)]);
  return c.json({ success: true, data: { members, ...queue } }, 200);
}

/** GET /team/candidates */
export async function listCandidates(c: Context<AppContext>) {
  return c.json({ success: true, data: await team.listTeamCandidates(getDb(c.env.DB)) }, 200);
}

/** POST /team/members */
export async function addMember(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = valid<z.infer<typeof v.addMemberSchema>>(c, "json");
  const added = await team.addTeamMember(db, body.userId, body.receiving);
  if (!added.ok) throw membershipRefusal(added.reason, body.userId);
  if (body.receiving) await shareOutWaiting(db, new Date(), ruleOf(c));
  await logActivity(db, c.get("user"), ACTIONS.TEAM_MEMBER_ADDED, { type: "user", id: body.userId }, { receiving: body.receiving });
  return c.json({ success: true, data: (await team.listTeamMembers(db)).find((m) => m.userId === body.userId) }, 201);
}

/** PATCH /team/members/{userId} */
export async function updateMember(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { userId } = valid<z.infer<typeof v.userIdParams>>(c, "param");
  const { receiving } = valid<z.infer<typeof v.receivingSchema>>(c, "json");
  await changeReceiving(c, userId, receiving);
  return c.json({ success: true, data: (await team.listTeamMembers(db)).find((m) => m.userId === userId) }, 200);
}

/** DELETE /team/members/{userId} */
export async function removeMember(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { userId } = valid<z.infer<typeof v.userIdParams>>(c, "param");
  const removed = await team.removeTeamMember(db, userId);
  if (!removed.ok) throw membershipRefusal(removed.reason, userId);
  await shareOutWaiting(db, new Date(), ruleOf(c));
  await logActivity(db, c.get("user"), ACTIONS.TEAM_MEMBER_REMOVED, { type: "user", id: userId });
  return c.json({ success: true, message: "Removed from the confirmation team" }, 200);
}

async function changeReceiving(c: Context<AppContext>, userId: string, receiving: boolean) {
  const db = getDb(c.env.DB);
  const changed = await team.setReceiving(db, userId, receiving);
  if (!changed.ok) throw membershipRefusal(changed.reason, userId);
  if (receiving) await shareOutWaiting(db, new Date(), ruleOf(c));
  await logActivity(db, c.get("user"), ACTIONS.TEAM_RECEIVING_CHANGED, { type: "user", id: userId }, { receiving });
}

/** GET /team/me */
export async function myMembership(c: Context<AppContext>) {
  return c.json({ success: true, data: await team.teamMembership(getDb(c.env.DB), c.get("user").id) }, 200);
}

/** PUT /team/me/receiving — a member starts or stops receiving new orders themselves. */
export async function setMyReceiving(c: Context<AppContext>) {
  const { receiving } = valid<z.infer<typeof v.receivingSchema>>(c, "json");
  await changeReceiving(c, c.get("user").id, receiving);
  return c.json({ success: true, data: await team.teamMembership(getDb(c.env.DB), c.get("user").id) }, 200);
}

/** GET /team/settings */
export async function getSettings(c: Context<AppContext>) {
  return c.json({ success: true, data: await team.getTeamConfig(getDb(c.env.DB)) }, 200);
}

/** PUT /team/settings */
export async function updateSettings(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = valid<z.infer<typeof v.teamConfigSchema>>(c, "json");
  const before = await team.getTeamConfig(db);
  const config = await team.setTeamConfig(db, body);
  if (config.distribution !== "manual") await shareOutWaiting(db, new Date(), ruleOf(c));
  await logActivity(db, c.get("user"), ACTIONS.TEAM_SETTINGS_UPDATED, { type: "store", id: "team" }, { before, after: config });
  return c.json({ success: true, data: config }, 200);
}

/** POST /orders/assign */
export async function assign(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = valid<z.infer<typeof v.assignOrdersSchema>>(c, "json");
  const [hidden] = await hiddenOrderIds(c, body.orderIds);
  if (hidden) throw new NotFoundError("Order", hidden);
  const outcome = await assignOrders(db, body.orderIds, body.to, c.get("author"));
  if (!outcome.ok) {
    if (outcome.reason === "member_not_found") throw new NotFoundError("User", body.to!);
    if (outcome.reason === "not_member") throw membershipRefusal("not_member", body.to!);
    if (outcome.reason === "no_order_access") throw new BusinessLogicError("This member cannot see orders yet, so they cannot be given one", ERROR_CODES.NO_ORDER_ACCESS, { userId: body.to });
    throw new BusinessLogicError("This member's account is inactive: they cannot take orders", ERROR_CODES.USER_INACTIVE, { userId: body.to });
  }
  return c.json({ success: true, data: outcome.results }, 200);
}

/** PUT /orders/{id}/callback */
export async function setCallback(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const { at } = valid<z.infer<typeof v.callbackSchema>>(c, "json");
  const changed = await setCallbackTime(db, orderId, at === null ? null : new Date(at).toISOString(), c.get("author"));
  if (!changed.ok) {
    if (changed.reason === "not_found") throw new NotFoundError("Order", orderId);
    throw new BusinessLogicError("A callback is set only on an order still waiting: new, or the customer not reached", ERROR_CODES.ORDER_NOT_WAITING, { orderId });
  }
  await logActivity(db, c.get("user"), ACTIONS.ORDER_CALLBACK_SET, { type: "order", id: orderId }, { at });
  return c.json({ success: true, data: { callbackAt: at === null ? null : new Date(at).toISOString() } }, 200);
}

/** POST /team/share-out */
export async function shareOut(c: Context<AppContext>) {
  const shared = await shareOutWaiting(getDb(c.env.DB), new Date(), ruleOf(c));
  return c.json({ success: true, data: { shared } }, 200);
}

/** GET /team/results */
export async function results(c: Context<AppContext>) {
  const { from, to } = valid<z.infer<typeof v.resultsQuerySchema>>(c, "query");
  return c.json({ success: true, data: await team.teamResults(getDb(c.env.DB), from, to) }, 200);
}

/** GET /team/members/{userId}/pay */
export async function listPay(c: Context<AppContext>) {
  const { userId } = valid<z.infer<typeof v.userIdParams>>(c, "param");
  return c.json({ success: true, data: await team.listPay(getDb(c.env.DB), userId) }, 200);
}

/** POST /team/members/{userId}/pay */
export async function setPay(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { userId } = valid<z.infer<typeof v.userIdParams>>(c, "param");
  const body = valid<z.infer<typeof v.payRateSchema>>(c, "json");
  if (!(await team.wasEverOnTeam(db, userId))) throw membershipRefusal("not_member", userId);
  const rate = await team.setPay(db, { userId, ...body, createdBy: c.get("user").id });
  await logActivity(db, c.get("user"), ACTIONS.TEAM_PAY_SET, { type: "user", id: userId }, { kind: rate.kind, amount: rate.amount, validFrom: rate.validFrom });
  return c.json({ success: true, data: rate }, 200);
}

/** DELETE /team/pay/{id} */
export async function removePay(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = valid<z.infer<typeof v.payIdParams>>(c, "param");
  const removed = await team.removePay(db, id);
  if (!removed) throw new NotFoundError("Pay rate", id);
  await logActivity(db, c.get("user"), ACTIONS.TEAM_PAY_REMOVED, { type: "user", id: removed.userId }, { payRateId: id, kind: removed.kind, amount: removed.amount, validFrom: removed.validFrom });
  return c.json({ success: true, message: "Pay rate removed" }, 200);
}

/** GET /team/payroll */
export async function payroll(c: Context<AppContext>) {
  const { month } = valid<z.infer<typeof v.payrollQuerySchema>>(c, "query");
  return c.json({ success: true, data: await team.payroll(getDb(c.env.DB), month) }, 200);
}
