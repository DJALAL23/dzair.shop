/**
 * The Event Log through the merchant's API, on real D1: read forward to
 * follow it, or back from the newest, each page joining the next without a
 * gap or a repeat; narrowed by type the way a Subscription names them, or to
 * one order; under `orders:read` only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { signIn } from "@/test-utils/sign-in";
import { sampleOrder, sampleShipment } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { EVENT_CATALOGUE, type EventType } from "../../../../cod-shared/events/catalogue";
import eventsRouter from "./routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = ["*"];

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "u1@example.com", name: "Nadia", role: "staff", status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/events", eventsRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

/** Recorded in this order, so their Sequences are 1…n. */
const LOG: Array<{ type: EventType; orderId: string }> = [
  { type: "order.created", orderId: "o1" },
  { type: "order.confirmed", orderId: "o1" },
  { type: "order.created", orderId: "o2" },
  { type: "shipment.handed_off", orderId: "o1" },
  { type: "order.cancelled", orderId: "o2" },
  { type: "shipment.delivered", orderId: "o1" },
  { type: "order.created", orderId: "o3" },
];

beforeEach(async () => {
  scopes = ["*"];
  await d1.db.run(sql`DELETE FROM business_events`);
  await d1.db.run(sql`DELETE FROM sqlite_sequence WHERE name = 'business_events'`);
  for (const [i, { type, orderId }] of LOG.entries()) {
    const subject = EVENT_CATALOGUE[type].subject;
    const order = { ...sampleOrder, id: orderId };
    const data = subject === "order" ? { order, previousStatus: "new" } : { shipment: sampleShipment, order, reason: null };
    await d1.db.insert(schema.businessEvents).values({
      id: `evt_${i + 1}`, type, version: 1, subjectType: subject, subjectId: subject === "order" ? orderId : "s-1", orderId,
      actorKind: i % 2 ? "system" : "staff", actorId: i % 2 ? null : "u1", actorName: i % 2 ? null : "Nadia",
      origin: i % 2 ? "schedule" : "dashboard", occurredAt: `2026-10-25T09:0${i}:00.000Z`, recordedAt: `2026-10-25T09:0${i}:00.500Z`,
      data: JSON.stringify(data),
    });
  }
});

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}
const ids = (body: any): string[] => body.data.map((event: { id: string }) => event.id);

/** Every page, three at a time, from the first on, following each `nextCursor` the way the first page was read. */
async function readAll(filters: string, param: "after" | "before", from?: number) {
  const pages: string[][] = [];
  let cursor: number | null | undefined = from;
  do {
    const { status, body } = await get(`/api/events?limit=3${filters}${cursor === undefined ? "" : `&${param}=${cursor}`}`);
    expect(status).toBe(200);
    pages.push(ids(body));
    cursor = body.nextCursor;
  } while (cursor !== null);
  return pages;
}

describe("reading the Event Log", () => {
  it("follows it forward, oldest first, page after page, ending with no cursor", async () => {
    expect(await readAll("", "after", 0)).toEqual([["evt_1", "evt_2", "evt_3"], ["evt_4", "evt_5", "evt_6"], ["evt_7"]]);
    expect(await readAll("", "after", 5)).toEqual([["evt_6", "evt_7"]]);
  });

  it("reads back from the newest when no Sequence is given", async () => {
    expect(await readAll("", "before")).toEqual([["evt_7", "evt_6", "evt_5"], ["evt_4", "evt_3", "evt_2"], ["evt_1"]]);
  });

  it("gives no cursor when a page holds the last event exactly", async () => {
    const { body } = await get("/api/events?limit=7&after=0");
    expect(body.count).toBe(7);
    expect(body.nextCursor).toBeNull();
  });

  it("publishes each event with its envelope and data", async () => {
    const { body } = await get("/api/events?after=3&limit=2");
    expect(body.data[0]).toMatchObject({
      id: "evt_4", sequence: 4, type: "shipment.handed_off", version: 1,
      subject: { type: "shipment", id: "s-1" }, orderId: "o1",
      actor: { kind: "system", id: null, name: null }, origin: "schedule",
      data: { shipment: { id: "s-1" }, order: { id: "o1" } },
    });
    expect(body.data[1].actor).toEqual({ kind: "staff", id: "u1", name: "Nadia" });
  });

  it("narrows to the types named the way a Subscription names them", async () => {
    expect(ids((await get("/api/events?after=0&type=order.created")).body)).toEqual(["evt_1", "evt_3", "evt_7"]);
    expect(ids((await get("/api/events?after=0&type=shipment.*")).body)).toEqual(["evt_4", "evt_6"]);
    expect(ids((await get("/api/events?after=0&type=order.cancelled, shipment.delivered")).body)).toEqual(["evt_5", "evt_6"]);
    expect(ids((await get("/api/events?after=0&type=*")).body)).toHaveLength(7);
  });

  it("narrows to one order, and pages within it", async () => {
    expect(await readAll("&orderId=o1", "after", 0)).toEqual([["evt_1", "evt_2", "evt_4"], ["evt_6"]]);
    expect(await readAll("&orderId=o1", "before")).toEqual([["evt_6", "evt_4", "evt_2"], ["evt_1"]]);
    expect(ids((await get("/api/events?orderId=o2&type=order.cancelled")).body)).toEqual(["evt_5"]);
    expect(ids((await get("/api/events?orderId=nope")).body)).toEqual([]);
  });

  it.each([
    ["an unknown type", "type=order.everything"],
    ["an unknown subject", "type=parcel.*"],
    ["after and before together", "after=1&before=5"],
    ["a page too large", "limit=101"],
    ["a negative Sequence", "after=-1"],
  ])("refuses %s", async (_, query) => {
    const { status, body } = await get(`/api/events?${query}`);
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("one Business Event", () => {
  it("is read by its id", async () => {
    const { status, body } = await get("/api/events/evt_5");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: "evt_5", sequence: 5, type: "order.cancelled", data: { previousStatus: "new" } });
  });

  it("is a 404 once it is not in the log", async () => {
    const { status, body } = await get("/api/events/evt_99");
    expect(status).toBe(404);
    expect(body.code).toBe("BUSINESS_EVENT_NOT_FOUND");
  });
});

describe("who may read it", () => {
  it("anyone who may read orders", async () => {
    scopes = ["orders:read"];
    expect((await get("/api/events")).status).toBe(200);
    expect((await get("/api/events/evt_1")).status).toBe(200);
  });

  it("no one else", async () => {
    scopes = ["products:read", "integrations:read"];
    expect((await get("/api/events")).status).toBe(403);
    expect((await get("/api/events/evt_1")).status).toBe(403);
  });
});
