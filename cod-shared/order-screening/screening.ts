import { and, count, eq, gte, ne, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orderAttempts, orderRules, storeOrderProtectionConfig } from "../db/schema";
import { MAX_ORDER_NUMBER_DRAWS, drawOrderNumber } from "../lib/order-number";
import { attemptSignals, loadFacts, type AttemptSignals, type OrderSubmission, type ScreeningPorts } from "./facts";
import { decide, readsOnlyBlockList, readStoredConditions, type Rule, type RuleMatch, type Verdict } from "./rules";
import { isTemplateRuleKey } from "./templates";

/** Spam Orders saved in 24 hours, at most: a flood cannot fill the store's database. */
export const SPAM_ORDERS_PER_DAY = 5_000;

export interface Screening {
  verdict: Verdict;
  matches: RuleMatch[];
  phone: string;
  ipKey: string | null;
  deviceKey: string | null;
  signals: AttemptSignals;
}

/** The rules that run, in one read; null when the App is off or was never set up. */
async function liveRules(db: AppDb): Promise<Rule[] | null> {
  const rows = await db
    .select({ id: orderRules.id, name: orderRules.name, mode: orderRules.mode, action: orderRules.action, conditionsJson: orderRules.conditionsJson, templateRule: orderRules.templateRule })
    .from(storeOrderProtectionConfig)
    .leftJoin(orderRules, ne(orderRules.mode, "off"))
    .where(eq(storeOrderProtectionConfig.enabled, true))
    .all();
  if (rows.length === 0) return null;
  return rows.flatMap(({ id, name, mode, action, conditionsJson, templateRule }) => {
    if (id === null || name === null || mode === null || action === null || conditionsJson === null) return [];
    const conditions = readStoredConditions(conditionsJson);
    return conditions && !readsOnlyBlockList(conditions) ? [{ id, name, mode, action, conditions, templateRule: isTemplateRuleKey(templateRule) ? templateRule : null }] : [];
  });
}

/** The Verdict on a submission, or null when the App is off, nothing applies, or anything inside fails: the caller places the order. */
export async function screenOrderAttempt(db: AppDb, submission: OrderSubmission, ports: ScreeningPorts, now: string): Promise<Screening | null> {
  try {
    const rules = await liveRules(db);
    if (rules === null) return null;
    const facts = await loadFacts(db, rules, submission, ports, now);
    if (rules.length === 0 && !facts.blocked?.phone && !facts.blocked?.ip) return null;
    return { ...decide(rules, facts), phone: facts.phone, ipKey: facts.ipKey ?? null, deviceKey: facts.deviceKey ?? null, signals: attemptSignals(facts) };
  } catch (error) {
    console.error("[order-screening] screening failed, the order goes through:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Records an attempt that became an order. Never throws: the order is already placed. */
export async function recordAttempt(db: AppDb, screening: Screening, order: { id: string; orderNumber: string }, now: string): Promise<void> {
  try {
    await db.insert(orderAttempts).values({
      id: crypto.randomUUID(),
      createdAt: now,
      phone: screening.phone,
      ipKey: screening.ipKey,
      deviceKey: screening.deviceKey,
      signalsJson: JSON.stringify(screening.signals),
      outcome: screening.verdict === "flag" ? "flagged" : "accepted",
      orderId: order.id,
      orderNumber: order.orderNumber,
      matchesJson: JSON.stringify(screening.matches),
    });
  } catch (error) {
    console.error("[order-screening] could not record an attempt:", error instanceof Error ? error.message : String(error));
  }
}

export interface HeldLine {
  name: string;
  variantLabel: string | null;
  quantity: number;
}

/** What a Spam Order answers with: the numbers a placed order would have. */
export interface HeldAnswer {
  price: number;
  deliveryFee: number;
  couponDiscount: number;
  deliveryType: "home" | "stop_desk";
  lines: readonly HeldLine[];
}

export interface HeldOrder {
  orderId: string;
  orderNumber: string;
  price: number;
  deliveryFee: number;
  total: number;
  couponDiscount: number;
}

const heldOrder = (orderId: string, orderNumber: string, answer: HeldAnswer): HeldOrder => ({
  orderId,
  orderNumber,
  price: answer.price,
  deliveryFee: answer.deliveryFee,
  total: answer.price + answer.deliveryFee,
  couponDiscount: answer.couponDiscount,
});

const failedOn = (error: unknown, column: string) => {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  return `${error instanceof Error ? error.message : String(error)} ${cause ?? ""}`.includes(`UNIQUE constraint failed: order_attempts.${column}`);
};

async function spamOrdersSince(db: AppDb, since: string): Promise<number> {
  return (await db.select({ total: count() }).from(orderAttempts).where(and(eq(orderAttempts.outcome, "spam"), gte(orderAttempts.createdAt, since))).get())?.total ?? 0;
}

async function heldWithCheckoutKey(db: AppDb, checkoutKey: string, answer: HeldAnswer): Promise<HeldOrder | null> {
  const found = await db.select({ id: orderAttempts.id, orderNumber: orderAttempts.orderNumber }).from(orderAttempts).where(and(eq(orderAttempts.checkoutKey, checkoutKey), eq(orderAttempts.outcome, "spam"))).get();
  return found?.orderNumber ? heldOrder(found.id, found.orderNumber, answer) : null;
}

const changed = (result: unknown) => ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;

/** A number no order and no Spam Order has, for a Spam Order that is not saved. */
async function freeNumber(db: AppDb, now: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const orderNumber = drawOrderNumber(now);
    const [row] = await db.all<{ taken: number }>(sql`SELECT EXISTS (SELECT 1 FROM orders WHERE order_number = ${orderNumber}) OR EXISTS (SELECT 1 FROM order_attempts WHERE order_number = ${orderNumber}) AS taken`);
    if (!row?.taken || attempt >= MAX_ORDER_NUMBER_DRAWS) return orderNumber;
  }
}

/**
 * Keeps a Spam Order under a number no order has: the insert itself checks the orders, and the
 * unique index the other Spam Orders, so the shopper never holds another order's number.
 * Null when it could not be kept: the caller places the order instead.
 */
export async function holdOrder(db: AppDb, screening: Screening, held: { checkoutKey?: string; submission: unknown; answer: HeldAnswer }, now: string): Promise<HeldOrder | null> {
  try {
    const id = crypto.randomUUID();
    const dayAgo = new Date(Date.parse(now) - 86_400_000).toISOString();
    if ((await spamOrdersSince(db, dayAgo)) >= SPAM_ORDERS_PER_DAY) {
      console.error("[order-screening] daily limit of Spam Orders reached, not saving this one");
      return heldOrder(id, await freeNumber(db, now), held.answer);
    }
    for (let attempt = 1; ; attempt += 1) {
      const orderNumber = drawOrderNumber(now);
      try {
        const result = await db.run(sql`
          INSERT INTO order_attempts (id, created_at, phone, ip_key, device_key, signals_json, outcome, order_number, checkout_key, matches_json, submission_json, answer_json)
          SELECT ${id}, ${now}, ${screening.phone}, ${screening.ipKey}, ${screening.deviceKey}, ${JSON.stringify(screening.signals)}, 'spam', ${orderNumber}, ${held.checkoutKey ?? null}, ${JSON.stringify(screening.matches)}, ${JSON.stringify(held.submission)}, ${JSON.stringify(held.answer)}
          WHERE NOT EXISTS (SELECT 1 FROM orders WHERE order_number = ${orderNumber})`);
        if (changed(result)) return heldOrder(id, orderNumber, held.answer);
        if (attempt >= MAX_ORDER_NUMBER_DRAWS) throw new Error("no free order number");
      } catch (error) {
        if (held.checkoutKey && failedOn(error, "checkout_key")) return await heldWithCheckoutKey(db, held.checkoutKey, held.answer);
        if (attempt >= MAX_ORDER_NUMBER_DRAWS || !failedOn(error, "order_number")) throw error;
      }
    }
  } catch (error) {
    console.error("[order-screening] could not keep a Spam Order, placing it:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export interface HeldStatus {
  orderNumber: string;
  placedAt: string;
  phone: string;
  answer: HeldAnswer;
}

/** A Spam Order by its number, for the shopper's own look-up. */
export async function findHeldOrder(db: AppDb, orderNumber: string): Promise<HeldStatus | null> {
  const found = await db.select({ orderNumber: orderAttempts.orderNumber, placedAt: orderAttempts.createdAt, phone: orderAttempts.phone, answerJson: orderAttempts.answerJson }).from(orderAttempts).where(and(eq(orderAttempts.orderNumber, orderNumber), eq(orderAttempts.outcome, "spam"))).get();
  if (!found?.orderNumber || !found.answerJson) return null;
  return { orderNumber: found.orderNumber, placedAt: found.placedAt, phone: found.phone, answer: JSON.parse(found.answerJson) as HeldAnswer };
}

