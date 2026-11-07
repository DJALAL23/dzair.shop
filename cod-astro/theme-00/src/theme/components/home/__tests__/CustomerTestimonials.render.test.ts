// @vitest-environment node
/**
 * Customer quotes: real reviews only. A store with none shows nothing to a
 * shopper, and in the editor's preview shows where the quotes will go, so a
 * merchant can find the section and edit its heading.
 */
/// <reference types="vitest/globals" />

import { testLocals } from "../../../__tests__/support/locals";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { BlocksHandle } from "@wocart/theme/astro";
import CustomerTestimonials from "../CustomerTestimonials.astro";
import { en } from "@/theme/content/en";

const blocks = (preview: boolean) => ({ owner: { id: "s1", type: "customer-testimonials" }, slots: {}, fixed: {}, render: { preview } }) as unknown as BlocksHandle;

async function render(preview: boolean, items: unknown[] = []) {
  const container = await AstroContainer.create();
  return container.renderToString(CustomerTestimonials, {
    locals: testLocals(),
    props: { items, content: en, headingAlign: "center", scheme: undefined, style: undefined, blocks: blocks(preview) },
  });
}

describe("customer quotes with no reviews yet", () => {
  it("show nothing to a shopper", async () => {
    expect((await render(false)).trim()).toBe("");
  });

  it("show the heading and placeholder quotes in the editor's preview, hidden from screen readers", async () => {
    const html = await render(true);
    expect(html).toContain(en.testimonialsTitle);
    expect(html).toMatch(/class="[^"]*is-ghost[^"]*"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="[^"]*is-ghost/);
    expect(html.match(/class="[^"]*\bquote\b/g)?.length).toBe(3);
  });
});
