/**
 * Checks a real response against the published OpenAPI document — the
 * contract clients generate from — strictly: a field the document does not
 * declare is drift too, unless its schema allows extra properties.
 *
 * Covers the JSON Schema the generator emits for this API: `$ref`, `type`
 * (one or several, `null` included), `nullable`, `enum`, `const`,
 * `properties` / `required` / `additionalProperties`, `items`, and
 * `anyOf` / `oneOf` / `allOf`. Formats and bounds are the route validators'
 * job, not the contract's.
 */

type Schema = Record<string, any>;

export interface OpenApiDocument {
  paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>;
  components?: { schemas?: Record<string, Schema> };
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === "number" && actual === "integer");
}

export function schemaErrors(doc: OpenApiDocument, schema: Schema, value: unknown, at = "$"): string[] {
  if (schema.$ref) {
    const name = String(schema.$ref).replace("#/components/schemas/", "");
    const target = doc.components?.schemas?.[name];
    return target ? schemaErrors(doc, target, value, at) : [`${at}: unresolved ${schema.$ref}`];
  }
  if (schema.allOf) return (schema.allOf as Schema[]).flatMap((s) => schemaErrors(doc, s, value, at));
  const alternatives = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (alternatives) {
    if (value === null && schema.nullable) return [];
    const each = alternatives.map((s) => schemaErrors(doc, s, value, at));
    if (each.some((errors) => errors.length === 0)) return [];
    return [`${at}: matches none of ${alternatives.length} alternatives — ${each.map((e) => e[0]).join(" | ")}`];
  }

  const actual = typeOf(value);
  if (schema.const !== undefined && value !== schema.const) return [`${at}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`];
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
    if (!(value === null && schema.nullable)) return [`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`];
  }
  if (schema.type !== undefined) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (schema.nullable) types.push("null");
    if (!types.some((t) => typeMatches(t, actual))) return [`${at}: expected ${types.join(" | ")}, got ${actual}`];
  }

  if (actual === "array" && schema.items) {
    return (value as unknown[]).flatMap((item, i) => schemaErrors(doc, schema.items, item, `${at}[${i}]`));
  }
  if (actual === "object" && (schema.properties || schema.additionalProperties !== undefined || schema.type === "object")) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const errors: string[] = [];
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in object)) errors.push(`${at}.${key}: required but missing`);
    }
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) {
        if (item !== undefined) errors.push(...schemaErrors(doc, properties[key], item, `${at}.${key}`));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...schemaErrors(doc, schema.additionalProperties, item, `${at}.${key}`));
      } else if (schema.additionalProperties !== true) {
        errors.push(`${at}.${key}: not in the contract`);
      }
    }
    return errors;
  }
  return [];
}

/** The errors of a response body against the document's schema for this operation and status. */
export function responseErrors(doc: OpenApiDocument, method: string, path: string, status: number, body: unknown): string[] {
  const operation = doc.paths[path]?.[method.toLowerCase()];
  if (!operation) return [`${method.toUpperCase()} ${path} is not in the document`];
  const schema = operation.responses?.[String(status)]?.content?.["application/json"]?.schema;
  if (!schema) return [`${method.toUpperCase()} ${path} documents no JSON body for ${status}`];
  return schemaErrors(doc, schema, body);
}
