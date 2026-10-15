/**
 * The SQL stage and attention flag against the pure rules, on real D1: every
 * order status (and a legacy one) with no shipment, and with a shipment in
 * every handoff state and every combination of milestones and attention the
 * database accepts. They must agree on every one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import { ORDER_STATUSES, isOrderStatus } from "./lifecycle";
import { orderNeedsAttention, orderStage, type StageShipment } from "./stage";
import { orderNeedsAttentionSql, orderStageSql } from "./stage-sql";
import { HANDOFF_STATES } from "../shipments/model";

const T = "2026-10-14T08:00:00.000Z";
let d1: TestD1;

type Facts = StageShipment;
interface Case {
  id: string;
  status: string;
  shipment: Facts | null;
}

function shipmentCases(): Facts[] {
  const cases: Facts[] = [];
  for (const handoffState of HANDOFF_STATES) {
    for (const outForDelivery of [false, true]) {
      for (const returnStarted of [false, true]) {
        for (const closed of [null, "delivered", "returned", "cancelled"] as const) {
          if (closed === "cancelled" && outForDelivery) continue; // the database refuses it
          for (const attention of [false, true]) {
            cases.push({
              handoffState,
              outForDeliveryAt: outForDelivery ? T : null,
              returnStartedAt: returnStarted ? T : null,
              deliveredAt: closed === "delivered" ? T : null,
              returnedAt: closed === "returned" ? T : null,
              cancelledAt: closed === "cancelled" ? T : null,
              attentionSince: attention ? T : null,
            });
          }
        }
      }
    }
  }
  return cases;
}

const cases: Case[] = [];
for (const status of [...ORDER_STATUSES, "delivered"]) {
  cases.push({ id: `${status}-none`, status, shipment: null });
  shipmentCases().forEach((shipment, i) => cases.push({ id: `${status}-${i}`, status, shipment }));
}

beforeAll(async () => {
  d1 = await createTestD1();
  await d1.db.insert(schema.customers).values({ id: "c1", name: "K", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.deliveryCompanies).values({ id: "co", name: "Co", nameAr: "-", code: "co_ecotrack", provider: "ecotrack", createdAt: T, updatedAt: T });
  const statements = cases.flatMap((c) => [
    d1.db.insert(schema.orders).values({
      id: c.id, orderNumber: `ORD-${c.id}`, customerId: "c1", customerName: "K", phone: "0551234567", price: 1000,
      status: c.status as never, createdAt: T, updatedAt: T,
    }),
    ...(c.shipment
      ? [
          d1.db.insert(schema.shipments).values({
            id: `s-${c.id}`, orderId: c.id, kind: "carrier", companyId: "co", carrierParcelId: `p-${c.id}`, trackingNumber: `t-${c.id}`,
            deliveryType: "home", codAmount: 1000, revision: "r", createdAt: T, updatedAt: T, ...c.shipment,
          }),
        ]
      : []),
  ]);
  for (let i = 0; i < statements.length; i += 50) await d1.db.batch(statements.slice(i, i + 50) as never);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("the order's stage in SQL", () => {
  it(`agrees with the pure rules on all ${cases.length} combinations`, async () => {
    const rows = await d1.db
      .select({ id: schema.orders.id, stage: orderStageSql(), attention: orderNeedsAttentionSql() })
      .from(schema.orders)
      .leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
      .all();
    expect(rows).toHaveLength(cases.length);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const disagreements = cases.flatMap((c) => {
      const row = byId.get(c.id)!;
      const stage = isOrderStatus(c.status) ? orderStage(c.status, c.shipment) : null;
      const attention = orderNeedsAttention(c.shipment);
      return row.stage === stage && row.attention === attention ? [] : [{ case: c, expected: { stage, attention }, got: { stage: row.stage, attention: row.attention } }];
    });
    expect(disagreements).toEqual([]);
  });

  it("covers every stage and both attention values", async () => {
    const rows = await d1.db
      .select({ stage: orderStageSql(), attention: orderNeedsAttentionSql() })
      .from(schema.orders)
      .leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
      .all();
    const { ORDER_STAGES } = await import("./stage");
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set([...ORDER_STAGES, null]));
    expect(new Set(rows.map((r) => r.attention))).toEqual(new Set([true, false]));
  });
});
