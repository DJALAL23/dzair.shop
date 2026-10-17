/**
 * Every line of copy the theme ships is read somewhere. A key no component,
 * script or definition reads is dead text, translated three times and edited
 * by nobody — and a merchant editing it would see nothing change.
 */
import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";
import { en } from "@/theme/content/en";

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
/** A plural form (`cartItems_one`) is read through its message's key (`cartItems`). */
const messageKey = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");

describe("the content packs", () => {
  it("hold no key that nothing reads", () => {
    const source = themeSourceFiles()
      .filter((file) => !file.relPath.startsWith("theme/content/"))
      .map((file) => file.content)
      .join("\n");
    const unread = [...new Set(Object.keys(en).map(messageKey))].filter(
      (key) => !new RegExp(`\\b${key}\\b`).test(source) && !source.includes(kebab(key)),
    );
    expect(unread).toEqual([]);
  });
});
