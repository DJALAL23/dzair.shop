/**
 * Releases the Event Catalogue: writes the JSON Schema of every Event Type's
 * current version to src/events/released/. A version without a snapshot gets
 * one; a snapshot is advanced only to a schema that breaks nothing it promised
 * (a field or value added), so it always holds every field ever published and
 * `catalogue.contract.test.ts` holds each later schema to all of them (ADR
 * 0018). A breaking schema is refused: it needs a new version.
 *
 *   npm run events:release-catalogue
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { EVENT_CATALOGUE, EVENT_TYPES } from "../../cod-shared/events/catalogue";
import { eventDataJsonSchema, releasedSnapshotName } from "../src/events/catalogue";
import { breakingChanges } from "../src/events/compatibility";

const dir = resolve(import.meta.dirname, "../src/events/released");
mkdirSync(dir, { recursive: true });

const due: { file: string; schema: Record<string, unknown> }[] = [];
const refused: string[] = [];
for (const type of EVENT_TYPES) {
  const file = resolve(dir, releasedSnapshotName(type, EVENT_CATALOGUE[type].version));
  const current = eventDataJsonSchema(type);
  if (existsSync(file)) {
    const released = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (isDeepStrictEqual(released, current)) continue;
    const breaks = breakingChanges(released, current);
    if (breaks.length > 0) {
      refused.push(`${type} v${EVENT_CATALOGUE[type].version}:\n  ${breaks.join("\n  ")}`);
      continue;
    }
  }
  due.push({ file, schema: current });
}
if (refused.length > 0) {
  console.error(`Refused, nothing written — these break what was released, so they need a new version:\n${refused.join("\n")}`);
  process.exit(1);
}
for (const { file, schema } of due) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
console.log(due.length ? `Released:\n${due.map((d) => d.file).join("\n")}` : "Every current version is already released.");
