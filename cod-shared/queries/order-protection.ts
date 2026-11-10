import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orderAttempts, orderBlockList, orderRules, orders, storeOrderProtectionConfig } from "../db/schema";
import type { StoreLocale } from "../i18n/locales";
import type { RuleMode } from "../order-screening/conditions";
import type { AttemptSignals } from "../order-screening/facts";
import { readsOnlyBlockList, readStoredConditions, type Rule, type RuleDraft, type RuleMatch } from "../order-screening/rules";
import type { BlockListKind, OrderAttemptOutcome } from "../order-screening/signals";
import type { HeldLine } from "../order-screening/screening";
import { isTemplateName, isTemplateRuleKey, templateRules, type TemplateKey, type TemplateRuleKey } from "../order-screening/templates";

export async function getProtectionConfig(db: AppDb, storeId: string) {
  return db.select({ enabled: storeOrderProtectionConfig.enabled }).from(storeOrderProtectionConfig).where(eq(storeOrderProtectionConfig.storeId, storeId)).get();
}

const upsertConfig = (db: AppDb, storeId: string, enabled: boolean, now: string) =>
  db
    .insert(storeOrderProtectionConfig)
    .values({ id: crypto.randomUUID(), storeId, enabled, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: storeOrderProtectionConfig.storeId, set: { enabled, updatedAt: now } });

export async function setProtectionEnabled(db: AppDb, storeId: string, enabled: boolean, now: string): Promise<void> {
  await upsertConfig(db, storeId, enabled, now);
}

/** Stored rule, as the merchant sees it. `conditions` is null when it can no longer be read. */
export interface StoredRule extends Omit<Rule, "conditions" | "templateRule"> {
  conditions: Rule["conditions"] | null;
  templateKey: string | null;
  /** The template rule it came from while unrenamed: its name is shown in the reader's language. */
  templateRule: TemplateRuleKey | null;
  createdAt: string;
  updatedAt: string;
}

function storedRule(row: typeof orderRules.$inferSelect): StoredRule {
  const templateRule = isTemplateRuleKey(row.templateRule) ? row.templateRule : null;
  return { id: row.id, name: row.name, mode: row.mode, action: row.action, conditions: readStoredConditions(row.conditionsJson), templateKey: row.templateKey, templateRule, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** A rule that only asks the Block List no longer runs, since the Block List acts on its own; it is not shown either. */
const retired = (rule: StoredRule) => rule.conditions !== null && readsOnlyBlockList(rule.conditions);

export async function listRules(db: AppDb): Promise<StoredRule[]> {
  const rows = await db.select().from(orderRules).orderBy(asc(orderRules.createdAt), asc(orderRules.id)).all();
  return rows.map(storedRule).filter((rule) => !retired(rule));
}

export async function getRule(db: AppDb, id: string): Promise<StoredRule | null> {
  const row = await db.select().from(orderRules).where(eq(orderRules.id, id)).get();
  const rule = row ? storedRule(row) : null;
  return rule && !retired(rule) ? rule : null;
}

export async function countRules(db: AppDb): Promise<number> {
  return (await listRules(db)).length;
}

export async function createRule(db: AppDb, draft: RuleDraft, now: string): Promise<StoredRule> {
  const row = { id: crypto.randomUUID(), name: draft.name, mode: draft.mode, action: draft.action, conditionsJson: JSON.stringify(draft.conditions), templateKey: null, createdAt: now, updatedAt: now, templateRule: null };
  await db.insert(orderRules).values(row);
  return storedRule(row);
}

/** Saves a rule. Sent back under its template name, in any language, it keeps that name; renamed, it becomes the merchant's own. */
export async function updateRule(db: AppDb, id: string, draft: RuleDraft, now: string): Promise<StoredRule | null> {
  const current = await getRule(db, id);
  if (!current) return null;
  const keepsTemplateName = current.templateRule !== null && isTemplateName(current.templateRule, draft.name);
  const naming = keepsTemplateName ? {} : { name: draft.name, templateRule: null };
  const row = await db.update(orderRules).set({ ...naming, mode: draft.mode, action: draft.action, conditionsJson: JSON.stringify(draft.conditions), updatedAt: now }).where(eq(orderRules.id, id)).returning().get();
  return row ? storedRule(row) : null;
}

export async function setRuleMode(db: AppDb, id: string, mode: RuleMode, now: string): Promise<StoredRule | null> {
  const row = await db.update(orderRules).set({ mode, updatedAt: now }).where(eq(orderRules.id, id)).returning().get();
  return row ? storedRule(row) : null;
}

export async function deleteRule(db: AppDb, id: string): Promise<boolean> {
  return (await db.delete(orderRules).where(eq(orderRules.id, id)).returning({ id: orderRules.id })).length > 0;
}

/** Replaces the store's rules with a Template's, and turns the App on, as one change. */
export async function applyTemplate(db: AppDb, storeId: string, key: TemplateKey, locale: StoreLocale, now: string): Promise<void> {
  const inserts = templateRules(key, locale).map((rule, position) =>
    db.insert(orderRules).values({ id: crypto.randomUUID(), name: rule.name, mode: rule.mode, action: rule.action, conditionsJson: JSON.stringify(rule.conditions), templateKey: key, templateRule: rule.templateRule, createdAt: new Date(Date.parse(now) + position).toISOString(), updatedAt: now }),
  );
  await db.batch([db.delete(orderRules), upsertConfig(db, storeId, true, now), ...inserts]);
}

/** How many attempts each rule matched since a moment, Trial or Active. */
export async function ruleMatchCounts(db: AppDb, since: string): Promise<Record<string, number>> {
  const rows = await db.all<{ ruleId: string; total: number }>(sql`
    SELECT json_extract(match.value, '$.ruleId') AS ruleId, COUNT(*) AS total
    FROM order_attempts, json_each(order_attempts.matches_json) AS match
    WHERE order_attempts.created_at >= ${since}
    GROUP BY ruleId`);
  return Object.fromEntries(rows.map((row) => [row.ruleId, row.total]));
}

export async function listBlockList(db: AppDb, input: { kind?: BlockListKind; limit: number; offset: number }) {
  const where = input.kind ? eq(orderBlockList.kind, input.kind) : undefined;
  const [items, total] = await Promise.all([
    db.select().from(orderBlockList).where(where).orderBy(desc(orderBlockList.createdAt), asc(orderBlockList.id)).limit(input.limit).offset(input.offset).all(),
    db.select({ total: count() }).from(orderBlockList).where(where).get(),
  ]);
  return { items, total: total?.total ?? 0 };
}

export async function countBlockList(db: AppDb): Promise<number> {
  return (await db.select({ total: count() }).from(orderBlockList).get())?.total ?? 0;
}

/** Adds an entry; one already listed is answered as it stands, with its first note. */
export async function addToBlockList(db: AppDb, entry: { kind: BlockListKind; value: string; note: string | null }, now: string) {
  await db.insert(orderBlockList).values({ id: crypto.randomUUID(), kind: entry.kind, value: entry.value, note: entry.note, createdAt: now }).onConflictDoNothing();
  return (await db.select().from(orderBlockList).where(and(eq(orderBlockList.kind, entry.kind), eq(orderBlockList.value, entry.value))).get())!;
}

export async function removeFromBlockList(db: AppDb, id: string): Promise<boolean> {
  return (await db.delete(orderBlockList).where(eq(orderBlockList.id, id)).returning({ id: orderBlockList.id })).length > 0;
}

export interface AttemptView {
  id: string;
  createdAt: string;
  phone: string;
  ipKey: string | null;
  outcome: OrderAttemptOutcome;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  total: number | null;
  wilayaId: number | null;
  communeId: string | null;
  deliveryType: "home" | "stop_desk" | null;
  /** What a Spam Order asked for; an order's own lines are on the order. */
  lines: HeldLine[] | null;
  phoneBlocked: boolean;
  ipBlocked: boolean;
  matches: RuleMatch[];
  signals: AttemptSignals;
}

const submitted = (path: string) => sql.raw(`json_extract(${"order_attempts"}.submission_json, '$.data.${path}')`);

const ATTEMPT_COLUMNS = {
  id: orderAttempts.id,
  createdAt: orderAttempts.createdAt,
  phone: orderAttempts.phone,
  ipKey: orderAttempts.ipKey,
  outcome: orderAttempts.outcome,
  orderId: orderAttempts.orderId,
  orderNumber: orderAttempts.orderNumber,
  matchesJson: orderAttempts.matchesJson,
  signalsJson: orderAttempts.signalsJson,
  customerName: sql<string | null>`COALESCE(${submitted("customerName")}, ${orders.customerName})`,
  total: sql<number | null>`COALESCE(json_extract(${orderAttempts.answerJson}, '$.price') + json_extract(${orderAttempts.answerJson}, '$.deliveryFee'), ${orders.codAmount})`,
  wilayaId: sql<number | null>`COALESCE(${submitted("wilayaId")}, ${orders.wilayaId})`,
  communeId: sql<string | null>`COALESCE(${submitted("communeId")}, ${orders.communeId})`,
  deliveryType: sql<"home" | "stop_desk" | null>`COALESCE(json_extract(${orderAttempts.answerJson}, '$.deliveryType'), ${orders.deliveryType})`,
  linesJson: sql<string | null>`json_extract(${orderAttempts.answerJson}, '$.lines')`,
  phoneBlocked: sql<number>`EXISTS (SELECT 1 FROM order_block_list WHERE kind = 'phone' AND value = ${orderAttempts.phone})`,
  ipBlocked: sql<number>`EXISTS (SELECT 1 FROM order_block_list WHERE kind = 'ip' AND value = ${orderAttempts.ipKey})`,
};

type AttemptRow = { matchesJson: string; signalsJson: string; linesJson: string | null; phoneBlocked: number; ipBlocked: number } & Omit<AttemptView, "matches" | "signals" | "lines" | "phoneBlocked" | "ipBlocked">;

function attemptView({ matchesJson, signalsJson, linesJson, phoneBlocked, ipBlocked, ...row }: AttemptRow): AttemptView {
  return { ...row, lines: linesJson ? (JSON.parse(linesJson) as HeldLine[]) : null, phoneBlocked: Boolean(phoneBlocked), ipBlocked: Boolean(ipBlocked), matches: JSON.parse(matchesJson) as RuleMatch[], signals: JSON.parse(signalsJson) as AttemptSignals };
}

const attempts = (db: AppDb) => db.select(ATTEMPT_COLUMNS).from(orderAttempts).leftJoin(orders, eq(orders.id, orderAttempts.orderId));

export async function listAttempts(db: AppDb, input: { outcome?: OrderAttemptOutcome; limit: number; offset: number }) {
  const where = input.outcome ? eq(orderAttempts.outcome, input.outcome) : undefined;
  const [rows, total] = await Promise.all([
    attempts(db).where(where).orderBy(desc(orderAttempts.createdAt), desc(orderAttempts.id)).limit(input.limit).offset(input.offset).all(),
    db.select({ total: count() }).from(orderAttempts).where(where).get(),
  ]);
  return { items: rows.map(attemptView), total: total?.total ?? 0 };
}

export async function attemptOfOrder(db: AppDb, orderId: string): Promise<AttemptView | null> {
  const row = await attempts(db).where(eq(orderAttempts.orderId, orderId)).get();
  return row ? attemptView(row) : null;
}

const isSpamOrder = (id: string) => and(eq(orderAttempts.id, id), eq(orderAttempts.outcome, "spam"));

/** Takes a Spam Order for Rescue, once: a second click finds nothing to take. */
export async function claimSpamOrder(db: AppDb, id: string): Promise<{ submissionJson: string; orderNumber: string } | null> {
  const claimed = await db.update(orderAttempts).set({ outcome: "rescued" }).where(isSpamOrder(id)).returning({ submissionJson: orderAttempts.submissionJson, orderNumber: orderAttempts.orderNumber }).get();
  return claimed?.submissionJson && claimed.orderNumber ? { submissionJson: claimed.submissionJson, orderNumber: claimed.orderNumber } : null;
}

export async function spamOrderWasRescued(db: AppDb, id: string): Promise<boolean> {
  return (await db.select({ outcome: orderAttempts.outcome }).from(orderAttempts).where(eq(orderAttempts.id, id)).get())?.outcome === "rescued";
}

/** The Rescue went through. What was kept only to place it is no longer needed. */
export async function linkRescuedOrder(db: AppDb, id: string, order: { id: string; orderNumber: string }): Promise<void> {
  await db.update(orderAttempts).set({ orderId: order.id, orderNumber: order.orderNumber, submissionJson: null }).where(eq(orderAttempts.id, id));
}

/** The Rescue was refused: the order waits in Spam again. */
export async function releaseSpamOrder(db: AppDb, id: string): Promise<void> {
  await db.update(orderAttempts).set({ outcome: "spam" }).where(and(eq(orderAttempts.id, id), eq(orderAttempts.outcome, "rescued"), isNull(orderAttempts.orderId)));
}

export async function deleteSpamOrder(db: AppDb, id: string): Promise<boolean> {
  return (await db.delete(orderAttempts).where(isSpamOrder(id)).returning({ id: orderAttempts.id })).length > 0;
}

export const SPAM_ORDER_DAYS = 30;
export const ORDER_ATTEMPT_DAYS = 60;
const SWEEP_BATCH = 500;

/** Forgets old attempts, a bounded batch at a time. The orders they led to are not touched. */
export async function sweepOrderAttempts(db: AppDb, now: Date): Promise<void> {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  await db.run(sql`
    DELETE FROM order_attempts WHERE id IN (
      SELECT id FROM order_attempts
      WHERE (outcome = 'spam' AND created_at < ${before(SPAM_ORDER_DAYS)}) OR (outcome <> 'spam' AND created_at < ${before(ORDER_ATTEMPT_DAYS)})
      LIMIT ${SWEEP_BATCH}
    )`);
}
