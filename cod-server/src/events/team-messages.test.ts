import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../../../cod-shared/events/catalogue";
import { STORE_LOCALES } from "../../../cod-shared/i18n/locales";
import { MESSAGE_LANGUAGES, MESSAGE_TEXT_MAX, clip, renderTeamMessage } from "../../../cod-shared/events/messages";
import { exampleEvent } from "./examples";

/** The team's messages: every Event Type in every language, written from the event alone, never too long for Telegram. */

describe("the team's messages", () => {
  it("have a message for every Event Type in every store language", () => {
    expect(Object.keys(MESSAGE_LANGUAGES).sort()).toEqual([...STORE_LOCALES].sort());
    for (const locale of STORE_LOCALES) {
      expect(Object.keys(MESSAGE_LANGUAGES[locale].headline).sort()).toEqual([...EVENT_TYPES].sort());
      for (const type of EVENT_TYPES) {
        const text = renderTeamMessage(exampleEvent(type), locale);
        expect(text.length, `${type} in ${locale}`).toBeGreaterThan(0);
        expect(text, `${type} in ${locale}`).toContain(exampleEvent(type).data.order.number);
      }
    }
  });

  it("say each Event Type differently, in each language", () => {
    for (const locale of STORE_LOCALES) {
      const headlines = EVENT_TYPES.map((type) => renderTeamMessage(exampleEvent(type), locale).split("\n")[0]);
      expect(new Set(headlines).size, locale).toBe(EVENT_TYPES.length);
    }
  });

  it("are written in their own language", () => {
    const created = exampleEvent("order.created");
    expect(renderTeamMessage(created, "en")).toMatch(/^🛒 New order #ORD-20261025-0042\n👤 Amina Benali · 0551234567\n📍 Alger — Alger Centre \(home delivery\)\n• /);
    expect(renderTeamMessage(created, "fr")).toMatch(/^🛒 Nouvelle commande n° ORD-20261025-0042\n/);
    const arabic = renderTeamMessage(created, "ar");
    expect(arabic).toMatch(/^🛒 طلب جديد رقم ORD-20261025-0042\n/);
    expect(arabic).toContain("📍 الجزائر — الجزائر الوسطى (توصيل إلى المنزل)");
    expect(arabic).toContain("د.ج");
  });

  it("carry what the event says: the reason and the attempt of a failed delivery, the fields an edit changed", () => {
    const failed = exampleEvent("shipment.delivery_failed");
    const text = renderTeamMessage({ ...failed, data: { ...failed.data, attempt: 2, reason: "Client absent" } }, "en");
    expect(text).toMatch(/^⚠️ Delivery attempt 2 failed for order #ORD-20261025-0042/);
    expect(text).toContain("Reason: Client absent");
    const updated = exampleEvent("order.updated");
    expect(renderTeamMessage({ ...updated, data: { ...updated.data, changedFields: ["customerPhone", "destination"] } }, "fr")).toContain("Modifié: téléphone, adresse");
  });

  it("name the staff member or the AI agent's staff member behind a change", () => {
    const confirmed = exampleEvent("order.confirmed");
    expect(renderTeamMessage({ ...confirmed, actor: { kind: "staff", id: "u1", name: "Yacine" } }, "en")).toContain("By: Yacine");
    expect(renderTeamMessage({ ...confirmed, actor: { kind: "shopper", id: null, name: null } }, "en")).not.toContain("By:");
  });

  it("stay within Telegram's 4096 characters, however long the customer's name", () => {
    const created = exampleEvent("order.created");
    const name = "Ⅿ".repeat(10_000) + "😀".repeat(3000);
    const lines = Array.from({ length: 80 }, (_, i) => ({ ...created.data.order.lines[0]!, id: `l${i}`, name: "x".repeat(5000), variantLabel: "v".repeat(5000) }));
    const huge = { ...created, data: { order: { ...created.data.order, customer: { ...created.data.order.customer, name }, lines } } };
    for (const locale of STORE_LOCALES) {
      const text = renderTeamMessage(huge, locale);
      expect(text.length).toBeLessThanOrEqual(MESSAGE_TEXT_MAX);
      expect(text.endsWith("…")).toBe(true);
    }
  });

  it("list ten lines of an order, and count the rest", () => {
    const created = exampleEvent("order.created");
    const lines = Array.from({ length: 13 }, (_, i) => ({ ...created.data.order.lines[0]!, id: `l${i}`, name: `Item ${i}`, variantLabel: null }));
    const text = renderTeamMessage({ ...created, data: { order: { ...created.data.order, lines } } }, "en");
    expect(text).toContain("• 1 × Item 9\n• … (+3)\n💰 Total:".replace("1 ×", `${lines[0]!.quantity} ×`));
    expect(text).not.toContain("Item 10");
  });

  it("never cut a character in two", () => {
    expect(clip("😀😀😀", 4)).toBe("😀…");
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcd", 3)).toBe("ab…");
  });

  it("are plain text: what a customer typed is passed on as it is", () => {
    const created = exampleEvent("order.created");
    const text = renderTeamMessage({ ...created, data: { order: { ...created.data.order, customer: { ...created.data.order.customer, name: "<b>Boss</b> *x* [a](http://evil)" } } } }, "en");
    expect(text).toContain("👤 <b>Boss</b> *x* [a](http://evil) ·");
  });
});
