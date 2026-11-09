/**
 * The Order Protection App (a Checkout Check): the merchant's rules for
 * incoming orders, the Block List, and the Spam Orders waiting for a person.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { MessageResponseSchema } from "@/openapi/schemas";
import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { RULE_LIMITS, RULE_MODES } from "../../../../cod-shared/order-screening/conditions";
import { parseRule } from "../../../../cod-shared/order-screening/rules";
import { APP_SOURCES, blockListValue, BLOCK_LIST_KINDS, ORDER_ATTEMPT_OUTCOMES, VISIT_SOURCES } from "../../../../cod-shared/order-screening/signals";
import { TEMPLATE_KEYS } from "../../../../cod-shared/order-screening/templates";
import * as protection from "../../../../cod-shared/queries/order-protection";
import { assertOrderable, commitOrder, orderLines, quoteOrder } from "../store/place-order";
import * as storeQueries from "../store/queries";
import type { StoreOrderInput } from "../store/validation";
import { bodyOf, jsonContent, storeOf } from "./shared";

const WEEK_MS = 7 * 86_400_000;
const nowIso = () => new Date().toISOString();

const ConditionSchema = z.object({
  key: z.string(),
  op: z.string(),
  value: z.unknown().openapi({ description: "Depends on the operator: nothing, a number, a list, or `{ count, windowHours }`" }),
});

const RuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(RULE_MODES),
  action: z.enum(["spam", "flag", "accept"]),
  conditions: z.array(ConditionSchema).nullable().openapi({ description: "Null when this version can no longer read the rule; it is then skipped." }),
  templateKey: z.string().nullable(),
  matchesLastWeek: z.number().int().openapi({ description: "Attempts this rule matched in the last 7 days" }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RuleBody = z.object({
  name: z.string(),
  mode: z.string(),
  action: z.string(),
  conditions: z.array(z.unknown()),
});

const IdParams = z.object({ id: z.string().min(1) });

const PageQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const valid = <T>(c: Context<AppContext>, target: "query" | "param") => (c.req as any).valid(target) as T;
const idOf = (c: Context<AppContext>) => valid<{ id: string }>(c, "param").id;

async function rulesWithMatches(db: Parameters<typeof protection.listRules>[0]) {
  const [rules, matches] = await Promise.all([protection.listRules(db), protection.ruleMatchCounts(db, new Date(Date.now() - WEEK_MS).toISOString())]);
  return rules.map((rule) => ({ ...rule, matchesLastWeek: matches[rule.id] ?? 0 }));
}

function draftOf(c: Context<AppContext>) {
  const parsed = parseRule(bodyOf<typeof RuleBody>(c));
  if (!parsed.ok) throw new ValidationError("This rule cannot be saved", ERROR_CODES.VALIDATION_FAILED, { reason: parsed.code, conditionIndex: parsed.conditionIndex });
  return parsed.rule;
}

async function getProtection(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const [config, rules] = await Promise.all([protection.getProtectionConfig(db, store.id), rulesWithMatches(db)]);
  return c.json({ success: true, data: { enabled: config?.enabled ?? null, rules } }, 200);
}

const SwitchBody = z.object({ enabled: z.boolean() });

async function setEnabled(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const { enabled } = bodyOf<typeof SwitchBody>(c);
  await protection.setProtectionEnabled(db, store.id, enabled, nowIso());
  return c.json({ success: true, data: { enabled } }, 200);
}

const TemplateBody = z.object({ key: z.enum(TEMPLATE_KEYS) });

async function chooseTemplate(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  await protection.applyTemplate(db, store.id, bodyOf<typeof TemplateBody>(c).key, store.lang, nowIso());
  return c.json({ success: true, data: { enabled: true, rules: await rulesWithMatches(db) } }, 200);
}

async function createRule(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const draft = draftOf(c);
  if ((await protection.countRules(db)) >= RULE_LIMITS.rules) throw new BusinessLogicError(`A store can keep ${RULE_LIMITS.rules} rules`, ERROR_CODES.ORDER_RULE_LIMIT_REACHED, { limit: RULE_LIMITS.rules });
  return c.json({ success: true, data: { ...(await protection.createRule(db, draft, nowIso())), matchesLastWeek: 0 } }, 201);
}

async function updateRule(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const id = idOf(c);
  const saved = await protection.updateRule(db, id, draftOf(c), nowIso());
  if (!saved) throw new NotFoundError("Order Rule", id);
  return c.json({ success: true, data: { ...saved, matchesLastWeek: (await protection.ruleMatchCounts(db, new Date(Date.now() - WEEK_MS).toISOString()))[id] ?? 0 } }, 200);
}

const ModeBody = z.object({ mode: z.enum(RULE_MODES) });

async function setMode(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const id = idOf(c);
  const saved = await protection.setRuleMode(db, id, bodyOf<typeof ModeBody>(c).mode, nowIso());
  if (!saved) throw new NotFoundError("Order Rule", id);
  return c.json({ success: true, data: { ...saved, matchesLastWeek: (await protection.ruleMatchCounts(db, new Date(Date.now() - WEEK_MS).toISOString()))[id] ?? 0 } }, 200);
}

async function deleteRule(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const id = idOf(c);
  if (!(await protection.deleteRule(db, id))) throw new NotFoundError("Order Rule", id);
  return c.json({ success: true, message: "Rule deleted" }, 200);
}

const BlockListQuery = PageQuery.extend({ kind: z.enum(BLOCK_LIST_KINDS).optional() });
const BlockListBody = z.object({ kind: z.enum(BLOCK_LIST_KINDS), value: z.string(), note: z.string().trim().max(200).nullish() });

const BlockEntrySchema = z.object({ id: z.string(), kind: z.enum(BLOCK_LIST_KINDS), value: z.string(), note: z.string().nullable(), createdAt: z.string() });

async function listBlockList(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const query = valid<z.output<typeof BlockListQuery>>(c, "query");
  const { items, total } = await protection.listBlockList(db, query);
  return c.json({ success: true, data: items, total, limit: query.limit, offset: query.offset }, 200);
}

async function addToBlockList(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const body = bodyOf<typeof BlockListBody>(c);
  const value = blockListValue(body.kind, body.value);
  if (value === null) throw new ValidationError("This value cannot be blocked", ERROR_CODES.VALIDATION_FAILED, { field: "value" });
  if ((await protection.countBlockList(db)) >= RULE_LIMITS.blockList) throw new BusinessLogicError(`A store can block ${RULE_LIMITS.blockList} entries`, ERROR_CODES.BLOCK_LIST_LIMIT_REACHED, { limit: RULE_LIMITS.blockList });
  return c.json({ success: true, data: await protection.addToBlockList(db, { kind: body.kind, value, note: body.note || null }, nowIso()) }, 201);
}

async function removeFromBlockList(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const id = idOf(c);
  if (!(await protection.removeFromBlockList(db, id))) throw new NotFoundError("Block List Entry", id);
  return c.json({ success: true, message: "Removed from the Block List" }, 200);
}

const ActivityQuery = PageQuery.extend({ outcome: z.enum(ORDER_ATTEMPT_OUTCOMES).optional() });

const AttemptSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  phone: z.string(),
  ipKey: z.string().nullable(),
  outcome: z.enum(ORDER_ATTEMPT_OUTCOMES),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  total: z.number().nullable(),
  matches: z.array(z.object({ ruleId: z.string(), name: z.string(), mode: z.enum(["trial", "active"]), action: z.enum(["spam", "flag", "accept"]) })),
  signals: z.object({ fillSeconds: z.number().optional(), visitSource: z.enum(VISIT_SOURCES).optional(), appSource: z.enum(APP_SOURCES).optional(), networkCountry: z.string().optional(), networkOperator: z.string().optional() }),
});

async function listAttempts(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const query = valid<z.output<typeof ActivityQuery>>(c, "query");
  const { items, total } = await protection.listAttempts(db, query);
  return c.json({ success: true, data: items, total, limit: query.limit, offset: query.offset }, 200);
}

async function attemptOfOrder(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  return c.json({ success: true, data: await protection.attemptOfOrder(db, idOf(c)) }, 200);
}

interface KeptSubmission {
  data: StoreOrderInput;
  customFieldAnswers: Parameters<typeof commitOrder>[1]["customFieldAnswers"];
  locale: Parameters<typeof commitOrder>[1]["locale"];
  ipAddress?: string;
  userAgent?: string;
}

/** Through the normal order path: fresh price, fresh stock, the usual events. Claimed first, so two clicks make one order. */
async function placeRescued(db: Parameters<typeof protection.claimSpamOrder>[0], storeId: string, claim: NonNullable<Awaited<ReturnType<typeof protection.claimSpamOrder>>>) {
  const { data, customFieldAnswers, locale, ipAddress, userAgent } = JSON.parse(claim.submissionJson) as KeptSubmission;
  const now = nowIso();
  const lines = orderLines(data);
  const snapshot = await storeQueries.loadCatalogSnapshot(db, lines, now);
  assertOrderable(snapshot, lines);
  const quote = await quoteOrder(db, { storeId, now, snapshot, lines, data });
  const order = await commitOrder(db, { data, customFieldAnswers, rate: quote.delivery.rate, coupon: quote.coupon, snapshot, locale, ipAddress, userAgent, orderNumber: claim.orderNumber });
  if (!("replay" in order)) return order;
  if (!order.replay) throw new Error("The checkout's order was removed before it could be read");
  return order.replay;
}

async function rescue(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const id = idOf(c);
  const claim = await protection.claimSpamOrder(db, id);
  if (!claim) {
    if (await protection.spamOrderWasRescued(db, id)) throw new ConflictError("This order has already been rescued", ERROR_CODES.SPAM_ORDER_ALREADY_RESCUED);
    throw new NotFoundError("Spam Order", id);
  }
  try {
    const order = await placeRescued(db, store.id, claim);
    await protection.linkRescuedOrder(db, id, order);
    return c.json({ success: true, data: { orderId: order.id, orderNumber: order.orderNumber } }, 201);
  } catch (error) {
    await protection.releaseSpamOrder(db, id);
    throw error;
  }
}

async function deleteSpamOrder(c: Context<AppContext>) {
  const { db } = await storeOf(c);
  const id = idOf(c);
  if (!(await protection.deleteSpamOrder(db, id))) throw new NotFoundError("Spam Order", id);
  return c.json({ success: true, message: "Spam Order deleted" }, 200);
}

const READ = { scope: SCOPES.ORDER_PROTECTION_READ };
const MANAGE = { scope: SCOPES.ORDER_PROTECTION_MANAGE };
const TAGS = ["Apps"];
const ok = (description: string, schema: z.ZodType) => ({ 200: { description, content: jsonContent(schema) } });
const created = (description: string, schema: z.ZodType) => ({ 201: { description, content: jsonContent(schema) } });
const data = <T extends z.ZodType>(schema: T) => z.object({ success: z.boolean(), data: schema });
const page = <T extends z.ZodType>(schema: T) => z.object({ success: z.boolean(), data: z.array(schema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
const StateSchema = z.object({ enabled: z.boolean().nullable().openapi({ description: "Null before the App is set up" }), rules: z.array(RuleSchema) });

const routes = [
  defineRoute({ method: "get", path: "/order-protection", auth: READ, tags: TAGS, summary: "Get the Order Protection App", description: "Whether it is on, and the store's rules with what each matched in the last 7 days.", operationId: "getOrderProtectionApp", responses: ok("The App's state", data(StateSchema)), handler: getProtection }),
  defineRoute({ method: "put", path: "/order-protection", auth: MANAGE, tags: TAGS, summary: "Turn Order Protection on or off", description: "Rules are kept while it is off.", operationId: "setOrderProtectionEnabled", body: SwitchBody, responses: ok("The new state", data(SwitchBody)), handler: setEnabled }),
  defineRoute({ method: "post", path: "/order-protection/template", auth: MANAGE, tags: TAGS, summary: "Use a Template", description: "Replaces the store's rules with the Template's, and turns the App on.", operationId: "useOrderProtectionTemplate", body: TemplateBody, responses: ok("The App's state", data(StateSchema)), handler: chooseTemplate }),
  defineRoute({ method: "post", path: "/order-protection/rules", auth: MANAGE, tags: TAGS, summary: "Create a rule", description: "Refused with VALIDATION_FAILED and `reason` when any part of it is not understood.", operationId: "createOrderRule", body: RuleBody, responses: created("The rule", data(RuleSchema)), handler: createRule }),
  defineRoute({ method: "put", path: "/order-protection/rules/{id}", auth: MANAGE, tags: TAGS, summary: "Change a rule", description: "Replaces the rule.", operationId: "updateOrderRule", params: IdParams, body: RuleBody, responses: ok("The rule", data(RuleSchema)), handler: updateRule }),
  defineRoute({ method: "patch", path: "/order-protection/rules/{id}/mode", auth: MANAGE, tags: TAGS, summary: "Change a rule's mode", description: "Trial, Active or Off.", operationId: "setOrderRuleMode", params: IdParams, body: ModeBody, responses: ok("The rule", data(RuleSchema)), handler: setMode }),
  defineRoute({ method: "delete", path: "/order-protection/rules/{id}", auth: MANAGE, tags: TAGS, summary: "Delete a rule", description: "Removes the rule.", operationId: "deleteOrderRule", params: IdParams, responses: ok("Deleted", MessageResponseSchema), handler: deleteRule }),
  defineRoute({ method: "get", path: "/order-protection/block-list", auth: READ, tags: TAGS, summary: "List the Block List", description: "Newest first.", operationId: "listOrderBlockList", query: BlockListQuery, responses: ok("Entries", page(BlockEntrySchema)), handler: listBlockList }),
  defineRoute({ method: "post", path: "/order-protection/block-list", auth: MANAGE, tags: TAGS, summary: "Add to the Block List", description: "An entry already listed is answered as it stands.", operationId: "addToOrderBlockList", body: BlockListBody, responses: created("The entry", data(BlockEntrySchema)), handler: addToBlockList }),
  defineRoute({ method: "delete", path: "/order-protection/block-list/{id}", auth: MANAGE, tags: TAGS, summary: "Remove from the Block List", description: "Removes the entry.", operationId: "removeFromOrderBlockList", params: IdParams, responses: ok("Removed", MessageResponseSchema), handler: removeFromBlockList }),
  defineRoute({ method: "get", path: "/order-protection/attempts", auth: READ, tags: TAGS, summary: "List screened orders", description: "Newest first. `outcome=spam` lists the Spam Orders.", operationId: "listOrderAttempts", query: ActivityQuery, responses: ok("Attempts", page(AttemptSchema)), handler: listAttempts }),
  defineRoute({ method: "get", path: "/order-protection/orders/{id}", auth: READ, tags: TAGS, summary: "Why an order was flagged", description: "The attempt behind an order, or null.", operationId: "getOrderAttempt", params: IdParams, responses: ok("The attempt", data(AttemptSchema.nullable())), handler: attemptOfOrder }),
  defineRoute({ method: "post", path: "/order-protection/spam/{id}/rescue", auth: MANAGE, tags: TAGS, summary: "Rescue a Spam Order", description: "Places it as a normal order, at today's prices and stock. Refused with the reason when it no longer can be placed; it then stays in Spam.", operationId: "rescueSpamOrder", params: IdParams, responses: created("The order", data(z.object({ orderId: z.string(), orderNumber: z.string() }))), handler: rescue }),
  defineRoute({ method: "delete", path: "/order-protection/spam/{id}", auth: MANAGE, tags: TAGS, summary: "Delete a Spam Order", description: "Removes it for good.", operationId: "deleteSpamOrder", params: IdParams, responses: ok("Deleted", MessageResponseSchema), handler: deleteSpamOrder }),
];

const router = new OpenAPIHono<AppContext>();
for (const route of routes) router.openapi(route.route, route.handler);

export default router;
