import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIPPING_LABEL_CONFIG,
  LABEL_LIMITS,
  isDefaultShippingLabelConfig,
  parseShippingLabelConfig,
  serializeShippingLabelConfig,
  validateShippingLabelInput,
} from "./config";

describe("reading a store's label settings", () => {
  it("is the default for a store that never set them, or a row nobody can read", () => {
    for (const stored of [null, undefined, "", "not json", "[]", "42"]) {
      expect(parseShippingLabelConfig(stored)).toEqual(DEFAULT_SHIPPING_LABEL_CONFIG);
    }
  });

  it("keeps every readable setting and defaults only the unreadable ones", () => {
    const stored = JSON.stringify({ language: "ar", showLogo: false, senderPhone: " 023 45 67 89 ", showItems: "yes", openParcel: "allowed", footer: "شكرا لثقتكم", future: 1 });
    expect(parseShippingLabelConfig(stored)).toEqual({
      ...DEFAULT_SHIPPING_LABEL_CONFIG,
      language: "ar",
      showLogo: false,
      senderPhone: "023 45 67 89",
      openParcel: "allowed",
      footer: "شكرا لثقتكم",
    });
  });

  it("clamps an over-long footer rather than dropping it", () => {
    const footer = "x".repeat(LABEL_LIMITS.FOOTER_MAX + 30);
    expect(parseShippingLabelConfig(JSON.stringify({ footer })).footer).toHaveLength(LABEL_LIMITS.FOOTER_MAX);
  });

  it("stores the default as nothing, and anything else in one fixed shape", () => {
    expect(isDefaultShippingLabelConfig(DEFAULT_SHIPPING_LABEL_CONFIG)).toBe(true);
    const changed = { ...DEFAULT_SHIPPING_LABEL_CONFIG, footer: "Merci" };
    expect(isDefaultShippingLabelConfig(changed)).toBe(false);
    expect(parseShippingLabelConfig(serializeShippingLabelConfig(changed))).toEqual(changed);
    expect(serializeShippingLabelConfig({ ...changed })).toBe(serializeShippingLabelConfig(changed));
  });
});

describe("saving a store's label settings", () => {
  it("takes a full or partial document, the rest from the defaults", () => {
    expect(validateShippingLabelInput({ language: "ar", openParcel: "forbidden", footer: "  Merci  ", senderPhone: "0551 23 45 67" })).toEqual({
      ok: true,
      config: { ...DEFAULT_SHIPPING_LABEL_CONFIG, language: "ar", openParcel: "forbidden", footer: "Merci", senderPhone: "0551 23 45 67" },
    });
    expect(validateShippingLabelInput({ footer: "   ", senderPhone: "" })).toEqual({ ok: true, config: DEFAULT_SHIPPING_LABEL_CONFIG });
  });

  it("refuses every problem at once, each with its path", () => {
    const result = validateShippingLabelInput({
      language: "en",
      showLogo: "true",
      senderPhone: "call me",
      footer: "x".repeat(LABEL_LIMITS.FOOTER_MAX + 1),
      size: "A4",
      colour: "red",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => [issue.path, issue.code])).toEqual([
      ["colour", "UNKNOWN_KEY"],
      ["size", "INVALID_CHOICE"],
      ["language", "INVALID_CHOICE"],
      ["showLogo", "INVALID_FIELD"],
      ["senderPhone", "INVALID_PHONE"],
      ["footer", "TEXT_TOO_LONG"],
    ]);
  });

  it("refuses what is not a document", () => {
    for (const input of [null, "x", [], 3]) {
      expect(validateShippingLabelInput(input)).toMatchObject({ ok: false, issues: [{ path: "", code: "NOT_AN_OBJECT" }] });
    }
  });
});
