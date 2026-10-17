// @vitest-environment node
/**
 * The store's menus in the header and footer: the merchant's menu replaces
 * the theme's own links, every internal link stays in the shopper's language,
 * an address outside the store is left as typed, and a store without the menu
 * keeps the theme's links. The settings that name the menus are read against
 * the theme's declaration, so a handle the theme cannot use falls back.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { resolveThemeSettings } from "@wocart/theme";
import type { LocaleRouting, StoreMenu } from "@wocart/storefront";
import Footer from "@/theme/components/layout/Footer.astro";
import Header from "@/theme/components/layout/Header.astro";
import StoreLayout from "@/theme/layouts/StoreLayout.astro";
import { DEFAULT_CONFIG } from "@/theme/runtime/store";
import { menuLinks } from "@/theme/runtime/navigation";
import { theme00 } from "@/theme/theme";
import { fr } from "@/theme/content/fr";
import { localizeHref } from "@wocart/storefront";
import { testLocals } from "../support/locals";

const routing: LocaleRouting = { primary: "ar", published: ["ar", "fr"] };
const href = (path: string) => localizeHref(path, "fr", routing);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

const menu: StoreMenu = {
  handle: "main-menu",
  title: "Menu",
  items: [
    { label: "Accueil", href: "/", type: "home", children: [] },
    {
      label: "Boutique",
      href: "/products",
      type: "catalog",
      children: [
        { label: "Robes", href: "/category/robes", type: "category", children: [{ label: "Robe d'été", href: "/products/robe-ete", type: "product", children: [] }] },
      ],
    },
    { label: "Instagram", href: "https://instagram.com/boutique", type: "url", children: [] },
    { label: "Contact", href: "mailto:contact@boutique.dz", type: "url", children: [] },
  ],
};

describe("menuLinks", () => {
  it("localizes the store's paths, leaves other addresses as typed, and marks the current page", () => {
    const links = menuLinks(menu, href, "/category/robes")!;
    expect(links.map((link) => [link.href, link.external, link.active])).toEqual([
      ["/fr", false, false],
      ["/fr/products", false, false],
      ["https://instagram.com/boutique", true, false],
      ["mailto:contact@boutique.dz", false, false],
    ]);
    expect(links[1]!.children[0]).toMatchObject({ href: "/fr/category/robes", active: true });
    expect(links[1]!.children[0]!.children[0]).toMatchObject({ label: "Robe d'été", href: "/fr/products/robe-ete", active: false });
  });

  it("is null without a menu or with an empty one, so the theme's own links show", () => {
    expect(menuLinks(null, href, "/")).toBeNull();
    expect(menuLinks({ ...menu, items: [] }, href, "/")).toBeNull();
  });
});

describe("the header and footer", () => {
  const render = async (component: typeof Header | typeof Footer, withMenu: boolean) => {
    const container = await AstroContainer.create();
    return container.renderToString(component, {
      props: { config: DEFAULT_CONFIG, content: fr, menu: withMenu ? menuLinks(menu, href, "/") : null },
      locals: testLocals({ locale: "fr", routing, content: fr }),
    });
  };

  it("show the merchant's menu, every level of it, in the shopper's language", async () => {
    for (const component of [Header, Footer]) {
      const html = await render(component, true);
      const links = hrefs(html);
      for (const expected of ["/fr", "/fr/products", "/fr/category/robes", "/fr/products/robe-ete", "https://instagram.com/boutique", "mailto:contact@boutique.dz"]) {
        expect(links).toContain(expected);
      }
      expect(html).toContain("Robe d&#39;été");
      expect(html).not.toContain("#best-sellers");
    }
  });

  it("keep the theme's own links when the store has no such menu", async () => {
    for (const component of [Header, Footer]) {
      const links = hrefs(await render(component, false));
      expect(links).toContain("/fr/products");
      expect(links).toContain("/fr#best-sellers");
    }
  });
});

describe("the layout", () => {
  it("asks for the menus the merchant's settings name, and renders them", async () => {
    const asked: string[] = [];
    const client = { menus: { get: async (handle: string) => (asked.push(handle), handle === "top" ? menu : null) } };
    const container = await AstroContainer.create();
    const html = await container.renderToString(StoreLayout, {
      locals: testLocals({
        locale: "fr",
        routing,
        content: fr,
        config: { ...DEFAULT_CONFIG, themeSettings: { headerMenu: "top" } },
        client: client as never,
      }),
      request: new Request("https://example.dz/fr"),
    });
    expect(asked.sort()).toEqual(["footer", "top"]);
    expect(hrefs(html)).toContain("/fr/category/robes");
  });

  it("asks for no menu on a marketing page", async () => {
    const asked: string[] = [];
    const client = { menus: { get: async (handle: string) => (asked.push(handle), null) } };
    const container = await AstroContainer.create();
    await container.renderToString(StoreLayout, {
      props: { marketing: true },
      locals: testLocals({ client: client as never }),
      request: new Request("https://example.dz/lp/promo"),
    });
    expect(asked).toEqual([]);
  });
});

describe("the theme's settings", () => {
  it("name the header and footer menus, and fall back from a handle the theme cannot use", () => {
    expect(resolveThemeSettings(theme00, undefined).values).toEqual({ headerMenu: "main-menu", footerMenu: "footer" });
    const { values, issues } = resolveThemeSettings(theme00, { headerMenu: "top", footerMenu: "Not A Handle", font: "Tajawal" });
    expect(values).toEqual({ headerMenu: "top", footerMenu: "footer", font: "Tajawal" });
    expect(issues.map((issue) => issue.code)).toEqual(["invalid-setting"]);
  });

  it("offer only the fonts the theme ships", () => {
    expect(resolveThemeSettings(theme00, { font: "Comic Sans" }).values).not.toHaveProperty("font");
  });
});
