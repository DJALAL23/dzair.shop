import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orderBlockList, orderRules, storeOrderProtectionConfig } from "../db/schema";
import type { StoreLocale } from "../i18n/locales";
import type { RuleMode } from "../order-screening/conditions";
import { readStoredConditions, type Rule, type RuleDraft } from "../order-screening/rules";
import type { BlockListKind } from "../order-screening/signals";
import { templateRules, type TemplateKey } from "../order-screening/templates";

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
export interface StoredRule extends Omit<Rule, "conditions"> {
  conditions: Rule["conditions"] | null;
  templateKey: string | null;
  createdAt: string;
  updatedAt: string;
}

function storedRule(row: typeof orderRules.$inferSelect): StoredRule {
  return { id: row.id, name: row.name, mode: row.mode, action: row.action, conditions: readStoredConditions(row.conditionsJson), templateKey: row.templateKey, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function listRules(db: AppDb): Promise<StoredRule[]> {
  const rows = await db.select().from(orderRules).orderBy(asc(orderRules.createdAt), asc(orderRules.id)).all();
  return rows.map(storedRule);
}

export async function getRule(db: AppDb, id: string): Promise<StoredRule | null> {
  const row = await db.select().from(orderRules).where(eq(orderRules.id, id)).get();
  return row ? storedRule(row) : null;
}

export async function countRules(db: AppDb): Promise<number> {
  return (await db.select({ total: count() }).from(orderRules).get())?.total ?? 0;
}

export async function createRule(db: AppDb, draft: RuleDraft, now: string): Promise<StoredRule> {
  const row = { id: crypto.randomUUID(), name: draft.name, mode: draft.mode, action: draft.action, conditionsJson: JSON.stringify(draft.conditions), templateKey: null, createdAt: now, updatedAt: now };
  await db.insert(orderRules).values(row);
  return storedRule(row);
}

export async function updateRule(db: AppDb, id: string, draft: RuleDraft, now: string): Promise<StoredRule | null> {
  const row = await db.update(orderRules).set({ name: draft.name, mode: draft.mode, action: draft.action, conditionsJson: JSON.stringify(draft.conditions), updatedAt: now }).where(eq(orderRules.id, id)).returning().get();
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
  const inserts = templateRules(key, locale).map((rule) =>
    db.insert(orderRules).values({ id: crypto.randomUUID(), name: rule.name, mode: rule.mode, action: rule.action, conditionsJson: JSON.stringify(rule.conditions), templateKey: key, createdAt: now, updatedAt: now }),
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

