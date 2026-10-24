/**
 * Whether a schema can replace a released one without breaking a consumer
 * (ADR 0018). Consumers are promised they may ignore fields and enum values
 * they do not know, so adding either is safe; everything a consumer already
 * reads must keep its name, presence, nullability, type and format.
 *
 * Reads the JSON Schema zod emits. A keyword it does not know is an error, not
 * a pass: the guard is only as good as what it understands.
 */

type JsonSchema = Record<string, unknown>;

interface Shape {
  types: Set<string>;
  nullable: boolean;
  constValue?: unknown;
  enumValues?: Set<unknown>;
  format?: string;
  pattern?: string;
  properties?: Map<string, JsonSchema>;
  required: Set<string>;
  items?: JsonSchema;
}

const UNDERSTOOD = new Set([
  "$schema",
  "type",
  "anyOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "format",
  "pattern",
  "minimum",
  "maximum",
]);

function shapeOf(node: JsonSchema, path: string): Shape {
  for (const key of Object.keys(node)) {
    if (!UNDERSTOOD.has(key)) throw new Error(`${path}: the compatibility check does not understand "${key}"`);
  }
  if (node.anyOf) {
    const branches = node.anyOf as JsonSchema[];
    const others = branches.filter((b) => b.type !== "null");
    if (others.length !== 1 || branches.length - others.length !== 1 || Object.keys(node).length !== 1) {
      throw new Error(`${path}: only "anyOf" of one schema and null is understood`);
    }
    return { ...shapeOf(others[0], path), nullable: true };
  }
  const declared = node.type === undefined ? [] : Array.isArray(node.type) ? (node.type as string[]) : [node.type as string];
  if (declared.length === 0) throw new Error(`${path}: a schema without "type" is not understood`);
  return {
    types: new Set(declared.filter((t) => t !== "null")),
    nullable: declared.includes("null"),
    ...("const" in node ? { constValue: node.const } : {}),
    ...(node.enum ? { enumValues: new Set(node.enum as unknown[]) } : {}),
    ...(node.format ? { format: node.format as string } : node.pattern ? { pattern: node.pattern as string } : {}),
    ...(node.properties ? { properties: new Map(Object.entries(node.properties as Record<string, JsonSchema>)) } : {}),
    required: new Set((node.required as string[] | undefined) ?? []),
    ...(node.items ? { items: node.items as JsonSchema } : {}),
  };
}

/** Each way `current` would break a consumer of `released`; empty when it is safe. */
export function breakingChanges(released: JsonSchema, current: JsonSchema, path = "data"): string[] {
  const was = shapeOf(released, path);
  const now = shapeOf(current, path);
  const breaks: string[] = [];

  for (const type of now.types) {
    if (!was.types.has(type) && !(type === "integer" && was.types.has("number"))) breaks.push(`${path}: can now be ${type}`);
  }
  if (now.nullable && !was.nullable) breaks.push(`${path}: can now be null`);
  if ("constValue" in was && now.constValue !== was.constValue) breaks.push(`${path}: is no longer always ${JSON.stringify(was.constValue)}`);
  if (was.enumValues) {
    if (!now.enumValues) breaks.push(`${path}: is no longer one of a fixed list`);
    else for (const value of was.enumValues) if (!now.enumValues.has(value)) breaks.push(`${path}: no longer takes ${JSON.stringify(value)}`);
  }
  if (was.format !== now.format) breaks.push(`${path}: format changed from ${was.format ?? "none"} to ${now.format ?? "none"}`);
  if (was.pattern !== now.pattern) breaks.push(`${path}: pattern changed`);

  for (const [name, schema] of was.properties ?? []) {
    const next = now.properties?.get(name);
    if (!next) {
      breaks.push(`${path}.${name}: removed`);
      continue;
    }
    if (was.required.has(name) && !now.required.has(name)) breaks.push(`${path}.${name}: no longer always present`);
    breaks.push(...breakingChanges(schema, next, `${path}.${name}`));
  }
  if (was.items) {
    if (!now.items) breaks.push(`${path}[]: no longer a list of a known shape`);
    else breaks.push(...breakingChanges(was.items, now.items, `${path}[]`));
  }
  return breaks;
}
