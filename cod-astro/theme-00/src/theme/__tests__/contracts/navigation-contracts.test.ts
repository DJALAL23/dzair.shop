// @vitest-environment node
/**
 * Theme-00's navigation is the merchant's: the header, the phone menu and the
 * footer show the store menus its settings name — `main-menu` and `footer`,
 * which every store starts with — and nothing of the theme's own. Internal
 * links stay in the shopper's language; an address outside the store is left
 * as typed. Its colors and font are its settings too, read against its
 * declaration, so a value it cannot use falls back to its design.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { resolveThemeSettings } from "@wocart/theme";
import { localizeHref, type LocaleRouting, type StoreMenu } from "@wocart/storefront";
import Footer from "@/theme/components/layout/Footer.astro";
import Header from "@/theme/components/layout/Header.astro";
import StoreLayout from "@/theme/layouts/StoreLayout.astro";
import { DEFAULT_CONFIG } from "@/theme/runtime/store";
import { menuLinks } from "@/theme/runtime/navigation";
import { theme00 } from "@/theme/theme";
import { fr } from "@/theme/content/fr";
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

const MENU_HREFS = ["/fr", "/fr/products", "/fr/category/robes", "/fr/products/robe-ete", "https://instagram.com/boutique", "mailto:contact@boutique.dz"];

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

  it("is null when the store has no such menu", () => {
    expect(menuLinks(null, href, "/")).toBeNull();
  });
});

describe("the header and footer", () => {
  const render = async (component: typeof Header | typeof Footer, links: ReturnType<typeof menuLinks>) => {
    const container = await AstroContainer.create();
    return container.renderToString(component, {
      props: { config: DEFAULT_CONFIG, content: fr, menu: links },
      locals: testLocals({ locale: "fr", routing, content: fr }),
    });
  };

  it("show the merchant's menu, every level of it, in the shopper's language", async () => {
    for (const component of [Header, Footer]) {
      const html = await render(component, menuLinks(menu, href, "/"));
      for (const expected of MENU_HREFS) expect(hrefs(html)).toContain(expected);
      expect(html).toContain("Robe d&#39;été");
    }
  });

  it("give a phone the same menu, behind a button", async () => {
    const html = await render(Header, menuLinks(menu, href, "/"));
    expect(html).toMatch(/<button[^>]*popovertarget="site-menu"/);
    const panel = html.slice(html.indexOf('id="site-menu"'));
    for (const expected of MENU_HREFS) expect(hrefs(panel)).toContain(expected);
  });

  it("show no links of their own when the store has no such menu", async () => {
    const header = await render(Header, null);
    expect(header).not.toContain("site-menu");
    expect(header).not.toContain('class="nav-link"');
    const footer = await render(Footer, null);
    expect(footer).not.toContain(fr.footerQuickLinks);
  });
});

describe("the layout", () => {
  it("asks for the menus the merchant's settings name, and renders them", async () => {
    const asked: string[] = [];
    const client = { menus: { get: async (handle: string) => (asked.push(handle), handle === "top" ? menu : null) } };
    const container = await AstroContainer.create();
    const html = await container.renderToString(StoreLayout, {
      locals: testLocals({ locale: "fr", routing, content: fr, config: { ...DEFAULT_CONFIG, themeSettings: { headerMenu: "top" } }, client: client as never }),
      request: new Request("https://example.dz/fr"),
    });
    expect(asked.sort()).toEqual(["footer", "top"]);
    expect(hrefs(html)).toContain("/fr/category/robes");
  });

  it("paints the colors and the font of the theme's settings, never the old store columns", async () => {
    const container = await AstroContainer.create();
    const config = { ...DEFAULT_CONFIG, primaryColor: "#123456", fontFamily: "Almarai", themeSettings: { primaryColor: "#0a7e3c", font: "Tajawal" } };
    const html = await container.renderToString(StoreLayout, {
      locals: testLocals({ config, client: { menus: { get: async () => null } } as never }),
      request: new Request("https://example.dz/"),
    });
    expect(html).toContain("#0a7e3c");
    expect(html).toContain("--font-tajawal");
    expect(html).not.toContain("#123456");
    expect(html).not.toContain("--font-almarai");
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
  it("render the theme as designed when the store saved nothing", () => {
    expect(resolveThemeSettings(theme00, undefined).values).toEqual({
      primaryColor: "#0b3bbd",
      accentColor: "#f59e0b",
      backgroundColor: "#f4f5f7",
      font: "Readex Pro",
      headerMenu: "main-menu",
      footerMenu: "footer",
    });
  });

  it("fall back to the design for a value the theme cannot use", () => {
    const { values, issues } = resolveThemeSettings(theme00, { headerMenu: "Not A Handle", primaryColor: "red", font: "Comic Sans" });
    expect(values).toMatchObject({ headerMenu: "main-menu", primaryColor: "#0b3bbd", font: "Readex Pro" });
    expect(issues.map((issue) => issue.code)).toEqual(["invalid-setting", "invalid-setting", "invalid-setting"]);
  });
});
