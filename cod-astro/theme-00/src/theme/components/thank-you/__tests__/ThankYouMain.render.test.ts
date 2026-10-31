// @vitest-environment node
/**
 * The thank-you page is a surface the merchant edits like any other: the
 * confirmation shows the order its link names, in the merchant's words, with
 * the parts they keep, and other sections can follow it. In the editor's
 * preview, where no order was placed, it shows an example order.
 */
/// <reference types="vitest/globals" />

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createReadCache } from "@wocart/theme/astro";
import { describe, expect, it } from "vitest";
import Sections from "@/theme/components/surface/Sections.astro";
import { thankYouCatalog } from "@/theme/catalog/families/thank-you";
import { testLocals } from "@/theme/__tests__/support/locals";
import { en } from "@/theme/content/en";

async function render(document: unknown, params: Record<string, string | undefined>, preview = false) {
  const container = await AstroContainer.create();
  return container.renderToString(Sections, {
    props: { theme: thankYouCatalog, surface: "thank-you", document, params: { ...params, surface: "thank-you" }, reads: createReadCache(), preview },
    locals: testLocals(),
  });
}

const page = (props: Record<string, unknown>, more: unknown[] = []) => ({
  version: 1,
  surface: "thank-you",
  sections: [{ id: "thank-you-main", type: "thank-you-main", props }, ...more],
});

describe("the thank-you page", () => {
  it("confirms the order its link names, in the theme's words until the merchant edits them", async () => {
    const html = await render(null, { orderNumber: "ORD-20261031-0007", total: "4800" });
    expect(html).toContain("ORD-20261031-0007");
    expect(html).toContain(en.thankYouTitle);
    expect(html).toContain(en.step1Title);
    expect(html).toMatch(/href="\/track-order\?order=ORD-20261031-0007"/);
  });

  it("says what the merchant wrote, and shows only the parts they keep", async () => {
    const html = await render(page({ thankYouTitle: { en: "Your order is on its way to us" }, showSteps: false, showTrackOrder: false }), { orderNumber: "ORD-20261031-0007" });
    expect(html).toContain("Your order is on its way to us");
    expect(html).not.toContain(en.step1Title);
    expect(html).not.toContain("/track-order");
  });

  it("takes other sections after the confirmation", async () => {
    const html = await render(page({}, [{ id: "faq", type: "faq", props: { questions: [{ id: "q1", props: { question: { en: "When will it arrive?" } } }] } }]), { orderNumber: "ORD-20261031-0007" });
    expect(html.indexOf("ORD-20261031-0007")).toBeLessThan(html.indexOf("When will it arrive?"));
  });

  it("shows an example order in the editor's preview, where none was placed", async () => {
    expect(await render(null, {}, true)).toMatch(/ORD-\d{8}-\d{4}/);
  });
});
