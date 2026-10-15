import { describe, it, expect } from "vitest";
import { responseErrors, schemaErrors, type OpenApiDocument } from "./openapi-contract";

const doc: OpenApiDocument = {
  paths: {
    "/things/{id}": {
      get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Thing" } } } } } },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: "object",
        required: ["id", "kind"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["a", "b"] },
          count: { type: "integer" },
          price: { type: "number" },
          note: { type: ["string", "null"] },
          legacy: { type: "string", nullable: true },
          tags: { type: "array", items: { type: "string" } },
          extra: { type: "object", additionalProperties: true },
          map: { type: "object", additionalProperties: { type: "number" } },
          either: { anyOf: [{ type: "string" }, { type: "object", properties: { x: { type: "number" } } }] },
          flag: { const: true },
        },
      },
    },
  },
};

const thing = { id: "t1", kind: "a" };

describe("a response checked against the contract", () => {
  it("passes what the document declares", () => {
    expect(
      responseErrors(doc, "GET", "/things/{id}", 200, {
        ...thing, count: 2, price: 2, note: null, legacy: null, tags: ["x"], extra: { anything: 1 }, map: { a: 1 }, either: { x: 1 }, flag: true,
      }),
    ).toEqual([]);
  });

  it("reports a field the document does not declare", () => {
    expect(responseErrors(doc, "get", "/things/{id}", 200, { ...thing, webhookSecret: "••••abcd" })).toEqual(["$.webhookSecret: not in the contract"]);
  });

  it("reports a missing required field, a wrong type, a value out of the enum, and a null where none is allowed", () => {
    expect(schemaErrors(doc, { $ref: "#/components/schemas/Thing" }, { id: 1, count: 1.5, tags: [1], note: 3, kind: "c", price: null })).toEqual([
      "$.id: expected string, got integer",
      "$.count: expected integer, got number",
      "$.tags[0]: expected string, got integer",
      "$.note: expected string | null, got integer",
      '$.kind: "c" is not one of ["a","b"]',
      "$.price: expected number, got null",
    ]);
    expect(schemaErrors(doc, { $ref: "#/components/schemas/Thing" }, { id: "t1" })).toEqual(["$.kind: required but missing"]);
  });

  it("checks extra properties against their schema, alternatives and constants", () => {
    expect(schemaErrors(doc, { $ref: "#/components/schemas/Thing" }, { ...thing, map: { a: "1" }, either: 3, flag: false })).toEqual([
      "$.map.a: expected number, got string",
      "$.either: matches none of 2 alternatives — $.either: expected string, got integer | $.either: expected object, got integer",
      "$.flag: expected true, got false",
    ]);
  });

  it("an operation or status the document does not have is an error", () => {
    expect(responseErrors(doc, "post", "/things/{id}", 200, {})).toEqual(["POST /things/{id} is not in the document"]);
    expect(responseErrors(doc, "get", "/things/{id}", 201, {})).toEqual(["GET /things/{id} documents no JSON body for 201"]);
  });
});
