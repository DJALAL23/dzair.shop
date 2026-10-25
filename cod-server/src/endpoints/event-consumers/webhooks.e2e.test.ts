/**
 * Webhook Consumers through the merchant's API, the real drain and one D1:
 * added with a Signing Secret shown once, receiving only what is recorded
 * from then on, signed so an independent receiver verifies it — during a
 * rotation by either secret; edited, tested, deleted; never more than the
 * store may have, even when added at once; and a built-in Consumer only
 * started and stopped. No answer but the one that makes it ever holds a
 * secret in full.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { asc, eq } from "drizzle-orm";
import type { AppContext, Env } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { signIn } from "@/test-utils/sign-in";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { drain } from "@/events/drain";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";
import { recordEvent } from "../../../../cod-shared/events/record";
import { PREVIOUS_SECRET_SIGNS_FOR_MS, WEBHOOK_CONSUMERS_MAX } from "../../../../cod-shared/events/webhooks";
import { createWebhookConsumer, updateConsumer } from "../../../../cod-shared/events/consumers";
import consumersRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = ["*"];
let role: "admin" | "staff" = "admin";
let answer: () => Response;
const received: Array<{ url: string; headers: Headers; body: string }> = [];
const T = "2026-10-25T10:00:00.000Z";
const HOOK = { kind: "webhook", name: "Order system", url: "https://erp.example.dz/hooks", subscription: ["order.*", "shipment.delivered", "order.*"] };

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "u1@example.com", name: "Nadia", role, status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/event-consumers", consumersRouter);
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["*"];
  role = "admin";
  for (const table of [schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents, schema.activityLogs]) await d1.db.delete(table);
  await d1.db.insert(schema.eventConsumers).values({
    id: "meta-conversions", kind: "meta_capi", name: "Meta conversions", subscription: '["order.created"]', settings: "{}", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  received.length = 0;
  answer = () => new Response("ok");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    received.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return answer();
  });
});
afterEach(() => vi.unstubAllGlobals());

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
  return { status: res.status, body: (await res.json()) as any, text: "" };
}
const create = (over: Record<string, unknown> = {}) => call("POST", "/api/event-consumers", { ...HOOK, ...over });
const record = (orderId: string, occurredAt = new Date().toISOString()) =>
  d1.db.batch([
    recordEvent(d1.db, {
      type: "order.confirmed", subjectId: orderId, orderId, occurredAt, actor: { kind: "staff", id: "u1", name: "Nadia" }, origin: "dashboard",
      data: { order: { ...sampleOrder, id: orderId }, previousStatus: "new" },
    }),
  ]);
const runDrain = (now = new Date(Date.now() + 60_000)) => drain({ DB: d1.raw, EVENTS_QUEUE: { send: async () => {} } } as unknown as Env, { now: () => now });
const row = async (id: string) => (await d1.db.select().from(schema.eventConsumers).where(eq(schema.eventConsumers.id, id)).get())!;
const activity = () => d1.db.select().from(schema.activityLogs).orderBy(asc(schema.activityLogs.createdAt)).all();

/** A receiver's check, per Standard Webhooks, sharing no code with the sender. */
function verifies(secret: string, request: { headers: Headers; body: string }): boolean {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const expected = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64")).update(`${id}.${timestamp}.${request.body}`).digest();
  return request.headers.get("webhook-signature")!.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    const given = Buffer.from(signature ?? "", "base64");
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
}

describe("adding a webhook", () => {
  it("answers its Signing Secret once, and every other answer masks it", async () => {
    const { status, body } = await create();
    expect(status).toBe(201);
    const { consumer, signingSecret } = body.data;
    expect(signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(consumer).toMatchObject({
      kind: "webhook", name: "Order system", enabled: true, builtIn: false, subscription: ["order.*", "shipment.delivered"], catalogueVersion: 1, disabledReason: null, failingSince: null,
      deliveries: { due: 0, dead: 0 },
      webhook: { url: "https://erp.example.dz/hooks", signingSecret: `••••${signingSecret.slice(-4)}`, secretRotatedAt: null, previousSecretSignsUntil: null },
    });
    expect((await row(consumer.id)).signingSecret).toBe(signingSecret);

    const list = await call("GET", "/api/event-consumers");
    const one = await call("GET", `/api/event-consumers/${consumer.id}`);
    for (const answer of [list.body, one.body]) expect(JSON.stringify(answer)).not.toContain(signingSecret.slice("whsec_".length, -4));
    expect(list.body.data.find((c: { id: string }) => c.id === "meta-conversions")).toMatchObject({ builtIn: true, webhook: null });

    const [log] = await activity();
    expect(log).toMatchObject({ action: "event_consumer.created", entityId: consumer.id });
    expect(JSON.stringify(log)).not.toContain(signingSecret.slice("whsec_".length));
  });

  it("delivers to it what is recorded from then on, signed by its secret", async () => {
    await record("before");
    await runDrain();
    const { body } = await create();
    await record("after");
    await runDrain();

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request!.url).toBe("https://erp.example.dz/hooks");
    expect(verifies(body.data.signingSecret, request!)).toBe(true);
    const event = BUSINESS_EVENT_SCHEMA.parse(JSON.parse(request!.body));
    expect(event).toMatchObject({ type: "order.confirmed", orderId: "after" });
    expect(request!.headers.get("webhook-id")).toBe(event.id);
  });

  it.each([
    [{ url: "http://erp.example.dz/hooks" }, "The endpoint must use https"],
    [{ url: "https://192.168.1.20/hooks" }, "The endpoint must be on the public internet, not a private network or a reserved name"],
    [{ url: "https://localhost:8443/hooks" }, "The endpoint must be on the public internet, not a private network or a reserved name"],
    [{ url: "https://user:pw@erp.example.dz/" }, "Put no user name or password in the URL; authenticate the request by its signature"],
    [{ url: "erp.example.dz" }, "Not a URL"],
    [{ subscription: [] }, null],
    [{ subscription: ["order.shipped"] }, "Not an Event Type, a subject (`order.*`) or `*`"],
    [{ name: "   " }, null],
    [{ kind: "meta_capi" }, null],
  ])("refuses %o", async (over, message) => {
    const { status, body } = await create(over);
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
    if (message) expect(JSON.stringify(body.context)).toContain(message);
    expect(await d1.db.select().from(schema.eventConsumers).all()).toHaveLength(1);
  });

  it(`stops at ${WEBHOOK_CONSUMERS_MAX}, even when the last ones are added at once`, async () => {
    for (let i = 0; i < WEBHOOK_CONSUMERS_MAX - 2; i++) expect((await create({ name: `Hook ${i}` })).status).toBe(201);
    const racing = await Promise.all(Array.from({ length: 6 }, (_, i) => create({ name: `Racing ${i}` })));
    expect(racing.map((r) => r.status).sort()).toEqual([201, 201, 409, 409, 409, 409]);
    expect(racing.find((r) => r.status === 409)!.body.code).toBe("EVENT_CONSUMER_LIMIT_REACHED");
    const webhooks = await d1.db.select().from(schema.eventConsumers).where(eq(schema.eventConsumers.kind, "webhook")).all();
    expect(webhooks).toHaveLength(WEBHOOK_CONSUMERS_MAX);
  });

  it("is refused by the writer itself for a URL or Subscription the API would refuse", async () => {
    const now = new Date();
    await expect(createWebhookConsumer(d1.db, { name: "x", url: "https://169.254.169.254/", subscription: ["*"] }, now)).rejects.toThrow("private_host");
    await expect(createWebhookConsumer(d1.db, { name: "x", url: "https://erp.example.dz/", subscription: [] }, now)).rejects.toThrow("A Subscription is");
    const created = await createWebhookConsumer(d1.db, { name: "x", url: "https://erp.example.dz/", subscription: ["*"] }, now);
    await expect(updateConsumer(d1.db, created.ok ? created.consumer.id : "", { url: "http://erp.example.dz/" }, now)).rejects.toThrow("not_https");
    expect(await d1.db.select().from(schema.eventConsumers).all()).toHaveLength(2);
  });

  it("needs settings:integrations", async () => {
    role = "staff";
    scopes = ["orders:read"];
    expect((await create()).status).toBe(403);
    expect((await call("PATCH", "/api/event-consumers/meta-conversions", { enabled: false })).status).toBe(403);
    expect((await call("POST", "/api/event-consumers/meta-conversions/rotate-secret")).status).toBe(403);
    expect((await call("POST", "/api/event-consumers/meta-conversions/test", {})).status).toBe(403);
    expect((await call("DELETE", "/api/event-consumers/meta-conversions")).status).toBe(403);
    scopes = ["settings:integrations"];
    expect((await create()).status).toBe(201);
  });
});

describe("rotating a Signing Secret", () => {
  it("signs with both for a day, so the endpoint switches without refusing a Delivery", async () => {
    const { body } = await create();
    const id = body.data.consumer.id;
    const first = body.data.signingSecret as string;
    const rotation = await call("POST", `/api/event-consumers/${id}/rotate-secret`);
    expect(rotation.status).toBe(200);
    const second = rotation.body.data.signingSecret as string;
    expect(second).toMatch(/^whsec_/);
    expect(second).not.toBe(first);
    const rotatedAt = (await row(id)).secretRotatedAt!;
    expect(rotation.body.data.previousSecretSignsUntil).toBe(new Date(Date.parse(rotatedAt) + PREVIOUS_SECRET_SIGNS_FOR_MS).toISOString());

    await record("o1");
    await runDrain();
    const [during] = received;
    expect(verifies(first, during!)).toBe(true);
    expect(verifies(second, during!)).toBe(true);

    await record("o2");
    await runDrain(new Date(Date.parse(rotatedAt) + PREVIOUS_SECRET_SIGNS_FOR_MS));
    const after = received[1]!;
    expect(verifies(second, after)).toBe(true);
    expect(verifies(first, after)).toBe(false);

    const view = (await call("GET", `/api/event-consumers/${id}`)).body.data;
    expect(view.webhook).toMatchObject({ signingSecret: `••••${second.slice(-4)}`, secretRotatedAt: rotatedAt });
    const logs = await activity();
    expect(logs.map((l) => l.action)).toEqual(["event_consumer.created", "event_consumer.secret_rotated"]);
    expect(JSON.stringify(logs)).not.toContain(second.slice("whsec_".length, -4));
  });

  it("twice keeps only the latest two", async () => {
    const { body } = await create();
    const id = body.data.consumer.id;
    await call("POST", `/api/event-consumers/${id}/rotate-secret`);
    const third = (await call("POST", `/api/event-consumers/${id}/rotate-secret`)).body.data.signingSecret;
    const stored = await row(id);
    expect(stored.signingSecret).toBe(third);
    expect([stored.previousSigningSecret, stored.signingSecret]).not.toContain(body.data.signingSecret);
  });

  it("is refused for a built-in Consumer, and a 404 for none", async () => {
    expect((await call("POST", "/api/event-consumers/meta-conversions/rotate-secret")).body.code).toBe("EVENT_CONSUMER_BUILT_IN");
    expect((await row("meta-conversions")).signingSecret).toBeNull();
    expect((await call("POST", "/api/event-consumers/ghost/rotate-secret")).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
  });
});

describe("changing a webhook", () => {
  it("renames it, points it elsewhere and changes its Subscription, each written in the Activity Log", async () => {
    const id = (await create()).body.data.consumer.id;
    await d1.db.update(schema.eventConsumers).set({ failingSince: T }).where(eq(schema.eventConsumers.id, id));
    const { status, body } = await call("PATCH", `/api/event-consumers/${id}`, { name: "ERP", url: "https://erp2.example.dz/in", subscription: ["shipment.*"] });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ name: "ERP", subscription: ["shipment.*"], failingSince: null, webhook: { url: "https://erp2.example.dz/in" } });
    expect((await activity()).map((l) => l.action)).toEqual(["event_consumer.created", "event_consumer.updated"]);

    await record("o1");
    await runDrain();
    expect(received).toEqual([]);
  });

  it("refuses a private URL, keeping the one it has", async () => {
    const id = (await create()).body.data.consumer.id;
    expect((await call("PATCH", `/api/event-consumers/${id}`, { url: "https://10.0.0.1/" })).status).toBe(400);
    expect((await call("GET", `/api/event-consumers/${id}`)).body.data.webhook.url).toBe("https://erp.example.dz/hooks");
  });

  it("keeps a running webhook's failing streak when started again, and a stopped one's reason when stopped again", async () => {
    const id = (await create()).body.data.consumer.id;
    await d1.db.update(schema.eventConsumers).set({ failingSince: T }).where(eq(schema.eventConsumers.id, id));
    expect((await call("PATCH", `/api/event-consumers/${id}`, { enabled: true })).body.data).toMatchObject({ enabled: true, failingSince: T });

    await d1.db.update(schema.eventConsumers).set({ enabled: false, disabledReason: "gone" }).where(eq(schema.eventConsumers.id, id));
    expect((await call("PATCH", `/api/event-consumers/${id}`, { enabled: false })).body.data).toMatchObject({ enabled: false, disabledReason: "gone" });
    expect((await call("PATCH", `/api/event-consumers/${id}`, { enabled: true })).body.data).toMatchObject({ enabled: true, disabledReason: null, failingSince: null });
  });

  it("only starts and stops a built-in Consumer", async () => {
    for (const change of [{ name: "Mine" }, { url: "https://erp.example.dz/" }, { subscription: ["*"] }, { enabled: false, name: "Mine" }]) {
      expect((await call("PATCH", "/api/event-consumers/meta-conversions", change)).body.code).toBe("EVENT_CONSUMER_BUILT_IN");
    }
    expect(await row("meta-conversions")).toMatchObject({ name: "Meta conversions", enabled: true, settings: "{}" });
    expect((await call("PATCH", "/api/event-consumers/meta-conversions", { enabled: false })).body.data).toMatchObject({ enabled: false, disabledReason: "merchant" });
  });
});

describe("a Test Event", () => {
  it("is an example of the type asked, signed like a Delivery, recorded nowhere", async () => {
    const { body } = await create();
    const id = body.data.consumer.id;
    answer = () => new Response('{"ok":true}', { status: 200 });
    const test = await call("POST", `/api/event-consumers/${id}/test`, { type: "shipment.delivered" });
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ outcome: "delivered", httpStatus: 200, response: '{"ok":true}', error: null, event: { type: "shipment.delivered" } });

    const [request] = received;
    const event = BUSINESS_EVENT_SCHEMA.parse(JSON.parse(request!.body));
    expect(event).toMatchObject({ type: "shipment.delivered", sequence: 0 });
    expect(event.id).toBe(test.body.data.event.id);
    expect(event.id).toMatch(/^test_/);
    expect(request!.headers.get("webhook-id")).toBe(event.id);
    expect(verifies(body.data.signingSecret, request!)).toBe(true);

    expect(await d1.db.select().from(schema.businessEvents).all()).toEqual([]);
    expect(await d1.db.select().from(schema.eventDeliveries).all()).toEqual([]);
    expect((await activity()).at(-1)).toMatchObject({ action: "event_consumer.tested" });
  });

  it("is order.created when no type is said, and reaches a stopped webhook too", async () => {
    const id = (await create()).body.data.consumer.id;
    await call("PATCH", `/api/event-consumers/${id}`, { enabled: false });
    const test = await call("POST", `/api/event-consumers/${id}/test`);
    expect(test.body.data.event.type).toBe("order.created");
    expect(JSON.parse(received[0]!.body).type).toBe("order.created");
  });

  it("says what a failing endpoint did, changing nothing about the webhook", async () => {
    const id = (await create()).body.data.consumer.id;
    answer = () => new Response("bad signature", { status: 401 });
    const test = await call("POST", `/api/event-consumers/${id}/test`, {});
    expect(test.body.data).toMatchObject({ outcome: "retry", httpStatus: 401, response: "bad signature", error: "HTTP 401" });
    expect(await row(id)).toMatchObject({ enabled: true, failingSince: null });
  });

  it("is refused for a built-in Consumer, an unknown type, and a 404 for none", async () => {
    expect((await call("POST", "/api/event-consumers/meta-conversions/test", {})).body.code).toBe("EVENT_CONSUMER_BUILT_IN");
    const id = (await create()).body.data.consumer.id;
    expect((await call("POST", `/api/event-consumers/${id}/test`, { type: "order.shipped" })).status).toBe(400);
    expect((await call("POST", "/api/event-consumers/ghost/test", {})).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
    expect(received).toEqual([]);
  });
});

describe("deleting a webhook", () => {
  it("removes it with its Deliveries and their Attempts; the Business Events stay", async () => {
    const id = (await create()).body.data.consumer.id;
    await record("o1");
    await runDrain();
    expect(await d1.db.select().from(schema.eventDeliveryAttempts).all()).toHaveLength(1);

    const { status, body } = await call("DELETE", `/api/event-consumers/${id}`);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Webhook deleted" });
    expect(await d1.db.select().from(schema.eventConsumers).where(eq(schema.eventConsumers.id, id)).all()).toEqual([]);
    expect(await d1.db.select().from(schema.eventDeliveries).all()).toEqual([]);
    expect(await d1.db.select().from(schema.eventDeliveryAttempts).all()).toEqual([]);
    expect(await d1.db.select().from(schema.businessEvents).all()).toHaveLength(1);
    expect((await activity()).at(-1)).toMatchObject({ action: "event_consumer.deleted", entityId: id });
    expect((await call("DELETE", `/api/event-consumers/${id}`)).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
  });

  it("is refused for a built-in Consumer", async () => {
    expect((await call("DELETE", "/api/event-consumers/meta-conversions")).body.code).toBe("EVENT_CONSUMER_BUILT_IN");
    expect(await row("meta-conversions")).toBeTruthy();
  });
});
