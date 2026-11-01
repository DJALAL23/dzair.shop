// @vitest-environment node
// Must run in the node environment — see ProductDescription.render.test.ts.
/**
 * Footer render tests — the regression this whole feature exists to fix.
 *
 * Before this feature, the footer's "Shipping"/"Returns" column was two
 * dead `<span>`s with no `href` — a crawler saw policy labels that led
 * nowhere, which reads worse to a Meta Ads reviewer than no labels at all.
 * These tests pin that the column is now driven entirely by `config.pages`
 * (D6): real `<a href="/pages/<slug>">` elements, titled in the store's own
 * language, and — critically — that an empty `pages` array renders an empty
 * list rather than falling back to any hardcoded label.
 */
/// <reference types="vitest/globals" />

import { testLocals, TEST_CONFIG } from "../../../__tests__/support/locals";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import FooterPages from "@/theme/components/footer/FooterPages.astro";
import FooterAbout from "@/theme/components/footer/FooterAbout.astro";
import { en } from "@/theme/content/en";
import type { StoreConfig, StorePageLink } from "@wocart/storefront";

function page(overrides: Partial<StorePageLink> = {}): StorePageLink {
  return {
    id: "sp_1",
    kind: "terms",
    slug: "terms",
    title: "Terms and Conditions",
    position: 1,
    ...overrides,
  };
}

async function render(config: StoreConfig): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(FooterPages, { props: { title: en.footerSupport }, locals: testLocals({ config }) });
}

describe("Footer — the policy links column", () => {
  it("renders a real <a href> for every configured page, never a dead <span>", async () => {
    const html = await render({
      ...TEST_CONFIG,
      pages: [
        page({ id: "sp_terms", kind: "terms", slug: "terms", title: "Terms and Conditions", position: 1 }),
        page({ id: "sp_refund", kind: "refund", slug: "refund-policy", title: "Refund and Return", position: 3 }),
      ],
    });

    expect(html).toContain('href="/pages/terms"');
    expect(html).toContain("Terms and Conditions");
    expect(html).toContain('href="/pages/refund-policy"');
    expect(html).toContain("Refund and Return");
  });

  it("renders no page links, and no hardcoded label, when the store has none", async () => {
    const html = await render({ ...TEST_CONFIG, pages: [] });

    expect(html).not.toContain("/pages/");
    // The old hardcoded fallback labels this feature replaced — must never
    // reappear as dead text once the real link list is empty.
    expect(html).not.toContain("Shipping Info");
    expect(html).not.toContain("Returns & Exchange");
  });

  it("renders no dead contact span when pages are empty", async () => {
    const html = await render({ ...TEST_CONFIG, pages: [] });
    expect(html).not.toContain("Contact");
  });

  it("titles links exactly as the server resolved them — no client-side relabeling", async () => {
    const html = await render({
      ...TEST_CONFIG,
      pages: [page({ slug: "conditions-generales", title: "Conditions Générales de Vente" })],
    });
    expect(html).toContain('href="/pages/conditions-generales"');
    expect(html).toContain("Conditions Générales de Vente");
  });
});

describe("Footer — the about column", () => {
  async function about(props: Record<string, unknown>, config: StoreConfig = TEST_CONFIG): Promise<string> {
    const container = await AstroContainer.create();
    return container.renderToString(FooterAbout, { props: { showWhatsapp: false, ...props }, locals: testLocals({ config }) });
  }
  const link = (network: string, href: string, label = "") => ({ id: `s-${network}`, network, href, label });

  it("links each social page the merchant added, in a new tab that cannot reach back", async () => {
    const html = await about({ socialLinks: [link("instagram", "https://instagram.com/store"), link("tiktok", "https://tiktok.com/@store", "Our TikTok")] });
    expect(html.match(/<a href="https:\/\/(instagram|tiktok)\.com[^>]*target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${en.socialInstagram}"`);
    expect(html).toContain('aria-label="Our TikTok"');
  });

  it("draws nothing for a social link without an address, and no list without links", async () => {
    expect(await about({ socialLinks: [link("facebook", "")] })).not.toContain("footer-social");
    expect(await about({})).not.toContain("footer-social");
  });

  it("shows the store's logo, or its name when it has none", async () => {
    const withLogo = await about({}, { ...TEST_CONFIG, name: "Maya", logo: { key: "logo.png", url: "https://media.example.test/logo.png", width: 400, height: 120 } } as StoreConfig);
    expect(withLogo).toMatch(/<img[^>]*alt="Maya"/);
    const withoutLogo = await about({}, { ...TEST_CONFIG, name: "Maya", logo: null });
    expect(withoutLogo).not.toContain("<img");
    expect(withoutLogo).toContain("<span>Maya</span>");
  });
});
