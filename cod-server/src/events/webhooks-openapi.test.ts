/**
 * The document's `webhooks` section is the catalogue: one entry per Event
 * Type, nothing more, each describing exactly the Business Event a webhook
 * receives — its example accepted, any other type's refused, a missing or an
 * undeclared field refused — with the headers that sign it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { schemaErrors, type OpenApiDocument } from "@/test-utils/openapi-contract";
import { registerSpecEndpoint } from "@/openapi/serve";
import { EVENT_CATALOGUE, EVENT_TYPES, type EventType } from "../../../cod-shared/events/catalogue";
import { EVENT_DATA_SCHEMAS } from "./catalogue";
import { exampleEvent } from "./examples";
import { eventComponentName } from "./webhooks-openapi";

type Webhook = { post: { tags: string[]; summary: string; description: string; parameters: Array<{ name: string; in: string; required: boolean }>; requestBody: { required: boolean; content: { "application/json": { schema: { $ref: string }; example: unknown } } }; responses: Record<string, unknown> } };
let doc: OpenApiDocument & { webhooks: Record<string, Webhook> };

beforeAll(async () => {
  const app = new OpenAPIHono<AppContext>();
  registerSpecEndpoint(app);
  doc = (await (await app.request("/api/openapi.json", {}, { WORKER_URL: "https://api.example.com" } as never)).json()) as typeof doc;
});

const bodyOf = (type: EventType) => doc.webhooks[type]!.post.requestBody.content["application/json"];
const errorsAs = (type: EventType, value: unknown) => schemaErrors(doc, bodyOf(type).schema, value);

describe("the webhooks section", () => {
  it("has one webhook per Event Type, in the catalogue's order", () => {
    expect(Object.keys(doc.webhooks)).toEqual(EVENT_TYPES);
    for (const type of EVENT_TYPES) expect(Object.keys(doc.webhooks[type]!)).toEqual(["post"]);
  });

  it.each(EVENT_TYPES)("describes %s as the catalogue says, signed", (type) => {
    const { post } = doc.webhooks[type]!;
    expect(post.tags).toEqual(["Events"]);
    expect(post.summary).toBe(EVENT_CATALOGUE[type].summary);
    expect(post.description).toContain(`\`${type}\`, \`${EVENT_CATALOGUE[type].subject}.*\` or \`*\``);
    expect(post.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
      ["webhook-id", "header", true],
      ["webhook-timestamp", "header", true],
      ["webhook-signature", "header", true],
    ]);
    expect(post.requestBody.required).toBe(true);
    expect(bodyOf(type).schema).toEqual({ $ref: `#/components/schemas/${eventComponentName(type)}` });
    expect(Object.keys(post.responses)).toEqual(["200", "410", "default"]);
  });

  it.each(EVENT_TYPES)("accepts %s's example, and no other type's", (type) => {
    expect(bodyOf(type).example).toEqual(exampleEvent(type));
    expect(errorsAs(type, exampleEvent(type))).toEqual([]);
    for (const other of EVENT_TYPES.filter((t) => t !== type)) expect(errorsAs(type, exampleEvent(other)), other).not.toEqual([]);
  });

  it.each(EVENT_TYPES)("refuses %s without a field it promises, or with one it does not", (type) => {
    const { data, ...envelope } = exampleEvent(type);
    expect(errorsAs(type, { ...envelope, data: { ...data, surprise: true } })).not.toEqual([]);
    expect(errorsAs(type, { ...envelope, data, surprise: true })).not.toEqual([]);
    for (const key of Object.keys(EVENT_DATA_SCHEMAS[type].shape)) {
      const { [key]: _, ...without } = data as Record<string, unknown>;
      expect(errorsAs(type, { ...envelope, data: without }), key).not.toEqual([]);
    }
    const { occurredAt: _, ...noTime } = exampleEvent(type);
    expect(errorsAs(type, noTime)).not.toEqual([]);
  });

  it("names each event's schema after its type", () => {
    expect(eventComponentName("order.created")).toBe("OrderCreatedEvent");
    expect(eventComponentName("order.line_returned")).toBe("OrderLineReturnedEvent");
    expect(eventComponentName("shipment.out_for_delivery")).toBe("ShipmentOutForDeliveryEvent");
    expect(new Set(EVENT_TYPES.map(eventComponentName)).size).toBe(EVENT_TYPES.length);
  });
});
