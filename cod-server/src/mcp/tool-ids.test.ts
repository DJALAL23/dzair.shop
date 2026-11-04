import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { TOOL_SCHEMAS } from "./schemas";

const STARTER_ID = "store-1:starter:product:handbag";

/** Inputs whose ids are official codes with their own format, not record ids. */
const CODES = new Set(["wilayaId", "communeId"]);

const idInputs = Object.entries(TOOL_SCHEMAS).flatMap(([tool, shape]) =>
  Object.entries(shape)
    .filter(([key]) => /Ids?$/.test(key) && !CODES.has(key))
    .map(([key, schema]) => ({ tool, key, schema: schema as z.ZodTypeAny })),
);

describe("MCP tool ids", () => {
  it("finds the id inputs of every tool", () => {
    expect(idInputs.length).toBeGreaterThan(100);
  });

  it.each(idInputs.map((input) => [`${input.tool}.${input.key}`, input] as const))(
    "%s takes a record id of any shape",
    (_, { key, schema }) => {
      const value = key.endsWith("Ids") ? [STARTER_ID] : STARTER_ID;
      expect(schema.safeParse(value).error).toBeUndefined();
    },
  );
});
