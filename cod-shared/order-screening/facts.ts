import { sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { sourceOf, windowCountKey, type Condition, type ConditionKey, type Facts, type FactSource, type WindowValue } from "./conditions";
import type { Rule } from "./rules";
import { appSourceOf, ipKey, readCheckoutSignals, readNetworkSignals } from "./signals";

/** What Screening is told about a submission. */
export interface OrderSubmission {
  storeId: string;
  phone: string;
  ip?: string;
  name: string;
  address?: string;
  wilayaId: number;
  productIds: readonly string[];
  pieces: number;
  deliveryType: "home" | "stop_desk";
  checkoutContext?: string;
  visitorNetwork?: string;
  userAgent?: string;
}

export interface ScreeningPorts {
  limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export function submissionFacts(submission: OrderSubmission): Facts {
  const key = submission.ip ? ipKey(submission.ip) : null;
  const appSource = appSourceOf(submission.userAgent);
  return {
    ...readCheckoutSignals(submission.checkoutContext),
    ...readNetworkSignals(submission.visitorNetwork),
    ...(appSource ? { appSource } : {}),
    phone: submission.phone,
    ...(key ? { ipKey: key } : {}),
    name: submission.name,
    ...(submission.address ? { address: submission.address } : {}),
    wilayaId: submission.wilayaId,
    productIds: submission.productIds,
    pieces: submission.pieces,
    deliveryType: submission.deliveryType,
  };
}

interface Counted {
  column: string;
  value: (facts: Facts) => string | undefined;
  otherPhones?: boolean;
}

const COUNTED: Partial<Record<ConditionKey, Counted>> = {
  phone_orders: { column: "phone", value: (facts) => facts.phone },
  ip_orders: { column: "ip_key", value: (facts) => facts.ipKey },
  device_orders: { column: "device_key", value: (facts) => facts.deviceKey },
  device_phones: { column: "device_key", value: (facts) => facts.deviceKey, otherPhones: true },
};

interface WantedCount {
  key: ConditionKey;
  windowHours: number;
  column: string;
  value: string;
  since: string;
  otherPhones: boolean;
}

function wantedCounts(conditions: readonly Condition[], facts: Facts, now: string): WantedCount[] {
  const wanted = new Map<string, WantedCount>();
  for (const condition of conditions) {
    const counted = COUNTED[condition.key];
    if (!counted || sourceOf(condition) !== "attempts") continue;
    const value = counted.value(facts);
    if (value === undefined) continue;
    const { windowHours } = condition.value as WindowValue;
    wanted.set(windowCountKey(condition.key, windowHours), { key: condition.key, windowHours, column: counted.column, value, since: new Date(Date.parse(now) - windowHours * 3_600_000).toISOString(), otherPhones: counted.otherPhones === true });
  }
  return [...wanted.values()];
}

/** Each count over the attempts already saved, plus this one: "at least 3" holds on the third order, or the third number. */
async function windowCounts(db: AppDb, wanted: readonly WantedCount[], phone: string): Promise<Record<string, number>> {
  if (wanted.length === 0) return {};
  const columns = wanted.map((count, index) => {
    const saved = sql`${sql.identifier(count.column)} = ${count.value} AND created_at >= ${count.since}`;
    const tally = count.otherPhones ? sql`COUNT(DISTINCT CASE WHEN ${saved} AND phone <> ${phone} THEN phone END)` : sql`COALESCE(SUM(CASE WHEN ${saved} THEN 1 ELSE 0 END), 0)`;
    return sql`${tally} AS ${sql.identifier(`c${index}`)}`;
  });
  const oldest = wanted.map((count) => count.since).sort()[0];
  const anyOf = [...new Map(wanted.map((count) => [`${count.column}:${count.value}`, sql`${sql.identifier(count.column)} = ${count.value}`])).values()];
  const [row] = await db.all<Record<string, number>>(sql`SELECT ${sql.join(columns, sql`, `)} FROM order_attempts WHERE created_at >= ${oldest} AND (${sql.join(anyOf, sql` OR `)})`);
  return Object.fromEntries(wanted.map((count, index) => [windowCountKey(count.key, count.windowHours), (row?.[`c${index}`] ?? 0) + 1]));
}

async function history(db: AppDb, phone: string): Promise<NonNullable<Facts["history"]>> {
  const [row] = await db.all<{ delivered: number; returned: number }>(sql`
    SELECT COUNT(s.delivered_at) AS delivered, COUNT(s.returned_at) AS returned
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    JOIN shipments s ON s.order_id = o.id
    WHERE c.phone = ${phone}`);
  return { delivered: row?.delivered ?? 0, returned: row?.returned ?? 0 };
}

async function blocked(db: AppDb, facts: Facts): Promise<NonNullable<Facts["blocked"]>> {
  const rows = await db.all<{ kind: string }>(sql`
    SELECT kind FROM order_block_list
    WHERE (kind = 'phone' AND value = ${facts.phone}) OR (kind = 'ip' AND value = ${facts.ipKey ?? null})`);
  return { phone: rows.some((row) => row.kind === "phone"), ip: rows.some((row) => row.kind === "ip") };
}

async function burst(ports: ScreeningPorts, storeId: string, facts: Facts): Promise<boolean | undefined> {
  if (!ports.limiter || !facts.ipKey) return undefined;
  try {
    return !(await ports.limiter.limit({ key: `order-attempt:${storeId}:${facts.ipKey}` })).success;
  } catch {
    return undefined;
  }
}

/** Loads each source the rules need, once; a source no rule reads is never touched. */
export async function loadFacts(db: AppDb, rules: readonly Rule[], submission: OrderSubmission, ports: ScreeningPorts, now: string): Promise<Facts> {
  const facts = submissionFacts(submission);
  const conditions = rules.flatMap((rule) => rule.conditions);
  const needed = new Set<FactSource>(conditions.map(sourceOf));
  const [counts, past, onList, burstFact] = await Promise.all([
    needed.has("attempts") ? windowCounts(db, wantedCounts(conditions, facts, now), facts.phone) : undefined,
    needed.has("history") ? history(db, facts.phone) : undefined,
    needed.has("block_list") ? blocked(db, facts) : undefined,
    needed.has("burst") ? burst(ports, submission.storeId, facts) : undefined,
  ]);
  return {
    ...facts,
    ...(counts ? { windowCounts: counts } : {}),
    ...(past ? { history: past } : {}),
    ...(onList ? { blocked: onList } : {}),
    ...(burstFact === undefined ? {} : { burst: burstFact }),
  };
}

export type AttemptSignals = Pick<Facts, "fillSeconds" | "visitSource" | "appSource" | "networkCountry" | "networkOperator">;

/** The Signals worth showing a person beside an attempt. */
export function attemptSignals(facts: Facts): AttemptSignals {
  const { fillSeconds, visitSource, appSource, networkCountry, networkOperator } = facts;
  return {
    ...(fillSeconds === undefined ? {} : { fillSeconds }),
    ...(visitSource ? { visitSource } : {}),
    ...(appSource ? { appSource } : {}),
    ...(networkCountry ? { networkCountry } : {}),
    ...(networkOperator ? { networkOperator } : {}),
  };
}
