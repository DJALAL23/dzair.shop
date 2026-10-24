/**
 * Releases the Event Catalogue: writes the JSON Schema of every Event Type's
 * current version that has no snapshot yet to src/events/released/. A
 * snapshot is never overwritten — once written it is the promise
 * `catalogue.contract.test.ts` holds every later schema to (ADR 0018).
 *
 *   npm run events:release-catalogue
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVENT_CATALOGUE, EVENT_TYPES } from "../../cod-shared/events/catalogue";
import { eventDataJsonSchema, releasedSnapshotName } from "../src/events/catalogue";

const dir = resolve(import.meta.dirname, "../src/events/released");
mkdirSync(dir, { recursive: true });

const written: string[] = [];
for (const type of EVENT_TYPES) {
  const file = resolve(dir, releasedSnapshotName(type, EVENT_CATALOGUE[type].version));
  if (existsSync(file)) continue;
  writeFileSync(file, `${JSON.stringify(eventDataJsonSchema(type), null, 2)}\n`);
  written.push(file);
}
console.log(written.length ? `Released:\n${written.join("\n")}` : "Every current version is already released.");
