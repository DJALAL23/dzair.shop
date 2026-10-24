/**
 * Recording a Business Event on real D1 (ADR 0016): the event commits with
 * its change, under the change's own claim, or not at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { makeFaultyDb } from "@/test-utils/faulty-d1";
import { sampleOrder } from "@/test-utils/events";
import { EVENT_DATA_SCHEMAS } from "@/events/catalogue";
import type { AppDb } from "../db/client";
import { businessEvents, customerTags } from "../db/schema";
import type { BusinessEventDraft } from "./catalogue";
import { recordEvent } from "./record";

let d1: TestD1;
let db: AppDb;

beforeAll(async () => {
  d1 = await createTestD1();
  db = d1.db;
}, 120_000);

afterAll(async () => d1?.dispose());

const NOW = "2026-10-25T10:00:00.000Z";

function confirmed(orderId: string): BusinessEventDraft {
  return {
    type: "order.confirmed",
    subjectId: orderId,
    orderId,
    occurredAt: NOW,
    actor: { kind: "staff", id: "u-1", name: "Samira" },
    origin: "dashboard",
    data: { order: { ...sampleOrder, id: orderId }, previousStatus: "new" },
  };
}

/** A change with a claim: the tag is created only if its name is free; the claim is "my row exists". */
function claimTag(name: string, on: AppDb = db) {
  const id = crypto.randomUUID();
  const write = on.insert(customerTags).values({ id, name, createdAt: NOW, updatedAt: NOW }).onConflictDoNothing();
  const claimed = sql`exists (select 1 from ${customerTags} where ${customerTags.id} = ${id})`;
  return { write, claimed };
}

const eventsOf = (orderId: string) => db.select().from(businessEvents).where(eq(businessEvents.orderId, orderId)).orderBy(asc(businessEvents.seq)).all();

describe("recordEvent", () => {
  it("writes the whole envelope and the data the catalogue promises", async () => {
    const draft = confirmed("o-envelope");
    const before = Date.now();
    await db.batch([recordEvent(db, draft)]);
    const after = Date.now();

    const [row] = await eventsOf("o-envelope");
    expect(row).toMatchObject({
      type: "order.confirmed",
      version: 1,
      subjectType: "order",
      subjectId: "o-envelope",
      orderId: "o-envelope",
      actorKind: "staff",
      actorId: "u-1",
      actorName: "Samira",
      origin: "dashboard",
      occurredAt: NOW,
    });
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(row!.recordedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(row!.recordedAt)).toBeLessThanOrEqual(after);
    const data = JSON.parse(row!.data);
    expect(data).toEqual(draft.data);
    expect(EVENT_DATA_SCHEMAS["order.confirmed"].safeParse(data).success).toBe(true);
  });

  it("keeps a shopper's and the system's actor without a name", async () => {
    await db.batch([recordEvent(db, { ...confirmed("o-shopper"), actor: { kind: "shopper", id: null, name: null }, origin: "storefront" })]);
    const [row] = await eventsOf("o-shopper");
    expect(row).toMatchObject({ actorKind: "shopper", actorId: null, actorName: null, origin: "storefront" });
  });

  it("commits with the change when the claim holds", async () => {
    const { write, claimed } = claimTag("vip-commit");
    await db.batch([write, recordEvent(db, confirmed("o-commit"), claimed)]);
    expect(await eventsOf("o-commit")).toHaveLength(1);
  });

  it("records nothing for a change that lost its race", async () => {
    const first = claimTag("vip-race");
    const second = claimTag("vip-race");
    const [a, b] = await Promise.all([
      db.batch([first.write, recordEvent(db, confirmed("o-race"), first.claimed)]),
      db.batch([second.write, recordEvent(db, confirmed("o-race"), second.claimed)]),
    ]);
    expect([a, b].map(([tag]) => (tag as { meta: { changes: number } }).meta.changes).sort()).toEqual([0, 1]);
    expect(await eventsOf("o-race")).toHaveLength(1);
  });

  it("records nothing when the batch fails anywhere", async () => {
    const faulty = makeFaultyDb(d1.raw, (text) => text.startsWith('insert into "customer_tags"'));
    const { write, claimed } = claimTag("vip-fault", faulty);
    await expect(faulty.batch([recordEvent(faulty, confirmed("o-fault")), write])).rejects.toThrow("INJECTED FAULT");
    await expect(faulty.batch([write, recordEvent(faulty, confirmed("o-fault"), claimed)])).rejects.toThrow("INJECTED FAULT");
    expect(await eventsOf("o-fault")).toEqual([]);
  });

  it("numbers events in commit order, each with its own id", async () => {
    await Promise.all(Array.from({ length: 25 }, () => db.batch([recordEvent(db, confirmed("o-sequence"))])));
    const rows = await eventsOf("o-sequence");
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.id)).size).toBe(25);
    const seqs = rows.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(rows.map((r) => r.recordedAt)).toEqual([...rows.map((r) => r.recordedAt)].sort());
  });
});
