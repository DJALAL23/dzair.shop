// @vitest-environment node
/**
 * A shopper on `/fr/…` stays in French (ADR 0005, phase D): every internal
 * link a section or the footer renders carries the language prefix, links
 * merchants typed into a section are localized too, and nothing external,
 * fragment-only or a file is touched. The primary language keeps bare URLs.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { LocaleRouting } from "@wocart/storefront";
import FooterAbout from "@/theme/components/footer/FooterAbout.astro";
import FooterMenu from "@/theme/components/footer/FooterMenu.astro";
import FooterPages from "@/theme/components/footer/FooterPages.astro";
import { fr } from "@/theme/content/fr";
import { fakeStorefront, makeProduct, renderSections } from "../support/home-render";
import { testLocals, TEST_CONFIG } from "../support/locals";

const routing: LocaleRouting = { primary: "ar", published: ["ar", "fr"] };
const product = makeProduct({ id: "p-1", handle: "phone" });
/** A catalog larger than a section shows, so its "view all" link renders. */
const catalog = [product, ...Array.from({ length: 11 }, (_, i) => makeProduct({ id: `p-${i + 2}`, handle: `item-${i + 2}` }))];

/** Every href in the markup. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

/** Internal page links: root-relative, not a file. */
const internal = (links: string[]) => links.filter((href) => href.startsWith("/") && !/\.[a-z0-9]+$/i.test(href));

describe("links in French", () => {
  it("keeps every section link under /fr, including links merchants typed", async () => {
    const html = await renderSections(
      [
        { id: "h", type: "hero", props: { ctaPrimaryHref: "/category/phones", ctaSecondaryHref: "#best-sellers" } },
        { id: "b", type: "best-sellers", props: {} },
        { id: "w", type: "whatsapp-cta", props: { ctaHref: "https://wa.me/213551234567" } },
      ],
      fakeStorefront(catalog),
      { locale: "fr", content: fr, routing },
    );
    const links = hrefs(html);
    expect(links).toContain("/fr/category/phones");
    expect(links).toContain("/fr/products/phone");
    expect(links).toContain("#best-sellers");
    expect(links).toContain("https://wa.me/213551234567");
    expect(internal(links).filter((href) => !href.startsWith("/fr"))).toEqual([]);
  });

  it("keeps the primary language's links bare", async () => {
    const html = await renderSections([{ id: "b", type: "best-sellers", props: {} }], fakeStorefront([product]), {
      locale: "ar",
      routing,
    });
    expect(hrefs(html)).toContain("/products/phone");
    expect(internal(hrefs(html)).filter((href) => href.startsWith("/fr"))).toEqual([]);
  });

  it("localizes the footer's navigation and policy links", async () => {
    const container = await AstroContainer.create();
    const config = {
      ...TEST_CONFIG,
      pages: [{ id: "p", kind: "terms" as const, slug: "conditions", title: "Conditions", position: 1 }],
    };
    const locals = testLocals({ locale: "fr", routing, content: fr, config });
    const storeMenu = { handle: "footer", title: "Footer", items: [{ label: "Boutique", href: "/products", type: "catalog", children: [] }] };
    const html = [
      await container.renderToString(FooterAbout, { props: { text: fr.footerAbout }, locals }),
      await container.renderToString(FooterMenu, { props: { title: fr.footerQuickLinks, menu: "footer", storeMenu }, locals }),
      await container.renderToString(FooterPages, { props: { title: fr.footerSupport }, locals }),
    ].join("");
    const links = internal(hrefs(html));
    expect(links).toContain("/fr/pages/conditions");
    expect(links).toContain("/fr");
    expect(links).toContain("/fr/products");
    expect(links.filter((href) => !href.startsWith("/fr"))).toEqual([]);
  });
});
