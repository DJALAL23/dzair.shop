import { describe, expect, it } from "vitest";
import { z } from "zod";
import { breakingChanges } from "./compatibility";

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "output" }) as Record<string, unknown>;

const order = z.object({
  id: z.string(),
  status: z.enum(["new", "confirmed"]),
  total: z.object({ amount: z.string().regex(/^\d+\.\d{2}$/), currency: z.literal("DZD") }),
  notes: z.string().nullable(),
  placedAt: z.iso.datetime({ offset: true }),
  quantity: z.number().int(),
  lines: z.array(z.object({ id: z.string(), quantity: z.number().int() })),
  carrier: z.object({ name: z.string() }).nullable(),
});
const released = schema(order);

describe("breakingChanges", () => {
  it("finds nothing between a schema and itself", () => {
    expect(breakingChanges(released, released)).toEqual([]);
  });

  it("allows what consumers are promised to ignore: new fields and new enum values", () => {
    const grown = order.extend({
      locale: z.string().nullable().optional(),
      channel: z.string(),
      status: z.enum(["new", "confirmed", "returned"]),
      lines: z.array(z.object({ id: z.string(), quantity: z.number().int(), sku: z.string() })),
    });
    expect(breakingChanges(released, schema(grown))).toEqual([]);
  });

  it("allows narrowing what a consumer may receive", () => {
    expect(breakingChanges(released, schema(order.extend({ notes: z.string() })))).toEqual([]);
    const anyNumber = schema(z.object({ weight: z.number() }));
    expect(breakingChanges(anyNumber, schema(z.object({ weight: z.number().int() })))).toEqual([]);
  });

  it.each([
    ["a removed field", order.omit({ notes: true }), "data.notes: removed"],
    ["a renamed field", order.omit({ id: true }).extend({ orderId: z.string() }), "data.id: removed"],
    ["a field made optional", order.extend({ id: z.string().optional() }), "data.id: no longer always present"],
    ["a field made nullable", order.extend({ id: z.string().nullable() }), "data.id: can now be null"],
    ["a changed type", order.extend({ quantity: z.string() }), "data.quantity: can now be string"],
    ["an integer widened to any number", order.extend({ quantity: z.number() }), "data.quantity: can now be number"],
    ["a removed enum value", order.extend({ status: z.enum(["new"]) }), 'data.status: no longer takes "confirmed"'],
    ["an enum opened to any string", order.extend({ status: z.string() }), "data.status: is no longer one of a fixed list"],
    ["a changed currency", order.extend({ total: z.object({ amount: z.string().regex(/^\d+\.\d{2}$/), currency: z.literal("EUR") }) }), 'data.total.currency: is no longer always "DZD"'],
    ["a changed money format", order.extend({ total: z.object({ amount: z.string().regex(/^\d+$/), currency: z.literal("DZD") }) }), "data.total.amount: pattern changed"],
    ["a date that is no longer a date", order.extend({ placedAt: z.string() }), "data.placedAt: format changed from date-time to none"],
    ["a nested field removed", order.extend({ lines: z.array(z.object({ id: z.string() })) }), "data.lines[].quantity: removed"],
    ["a nullable object's field removed", order.extend({ carrier: z.object({}).nullable() }), "data.carrier.name: removed"],
  ])("refuses %s", (_, changed, expected) => {
    expect(breakingChanges(released, schema(changed))).toContain(expected);
  });

  it("refuses to judge a construct it does not understand", () => {
    const union = schema(z.object({ id: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]) }));
    expect(() => breakingChanges(union, union)).toThrow('data.id: only "anyOf" of one schema and null is understood');
    const tuple = schema(z.object({ pair: z.tuple([z.string(), z.string()]) }));
    expect(() => breakingChanges(tuple, tuple)).toThrow(/does not understand "prefixItems"/);
  });
});
