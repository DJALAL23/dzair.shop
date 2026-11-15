import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../../../../cod-shared/events/catalogue";
import { SUBJECTS } from "./model";

const words = (locale: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../locales/${locale}/events.json`), "utf8")) as Record<string, unknown>;
const at = (tree: unknown, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);

describe("the events' names", () => {
  it.each(["en", "fr", "ar"])("name every Event Type, and every subject a webhook can take whole, in %s", (locale) => {
    const named = words(locale);
    for (const type of EVENT_TYPES) expect(typeof at(named, `types.${type}`), type).toBe("string");
    for (const subject of SUBJECTS) expect(typeof at(named, `webhook.every_${subject}`), subject).toBe("string");
  });
});
