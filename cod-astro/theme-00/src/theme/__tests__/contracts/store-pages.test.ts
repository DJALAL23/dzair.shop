// @vitest-environment node
/**
 * The store's own pages — contact, search, order tracking, checkout — each
 * rendered as the store renders it: its main section through the SDK's
 * renderer, in the shopper's language.
 *
 * Contact shows only what the store has: its WhatsApp from the App, its
 * phone, email and address from its own details, the merchant's hours and
 * note in the page's language. Search lists what the platform finds. The
 * tracking form and the checkout's order form render with their words.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import InstanceView from "@wocart/theme/astro/InstanceView.astro";
import { createReadCache } from "@wocart/theme/astro";
import type { ProductList, StoreConfig, StoreWhatsAppWidget } from "@wocart/storefront";
import { theme00 } from "@/theme/theme";
import { fr } from "@/theme/content/fr";
import { makeProduct } from "../support/home-render";
import { testLocals, TEST_CONFIG } from "../support/locals";

const WIDGET: StoreWhatsAppWidget = {
  href: "https://wa.me/213551234567",
  agentName: null,
  caption: null,
  avatarUrl: null,
  welcomeMessage: null,
  launcherLabel: null,
  ctaLabel: null,
  prefillGeneral: null,
  prefillProduct: null,
  thankYouButtonLabel: null,
  prefillThankYou: null,
  accent: "whatsapp",
  position: "right",
  attention: false,
  surfaces: { home: true, catalog: true, product: true, pages: true, thankYou: true, checkout: true, landing: true },
};

async function render(type: string, options: { props?: Record<string, unknown>; config?: Partial<StoreConfig>; params?: Record<string, string>; found?: ProductList[] } = {}) {
  const config: StoreConfig = { ...TEST_CONFIG, locale: "fr", ...options.config };
  const searched: string[] = [];
  const client = {
    products: {
      search: async (text: string) => {
        searched.push(text);
        const items = options.found ?? [];
        return { items, hasNext: false, total: items.length };
      },
    },
    shipping: { rates: async () => ({}) },
  };
  const container = await AstroContainer.create();
  const html = await container.renderToString(InstanceView, {
    props: {
      instance: { id: "main", type, props: options.props ?? {} },
      theme: theme00,
      context: { store: config, content: fr, locale: "fr", fallbackLocales: ["ar"], isRTL: false, url: "/", params: options.params ?? {} },
      storefront: client as never,
      reads: createReadCache(),
    },
    locals: testLocals({ locale: "fr", content: fr, config, client: client as never, pathname: "/contact", routing: { primary: "ar", published: ["ar", "fr"] } }),
    request: new Request("https://boutique.test/fr/contact"),
  });
  return { html, searched };
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

describe("the contact page", () => {
  it("shows each way to reach the store it has, from the store's own details", async () => {
    const { html } = await render("contact-main", { config: { whatsapp: WIDGET, contact: { phone: "0551 23 45 67", email: "bonjour@boutique.dz", address: "Bab Ezzouar, Alger" } } });
    expect(html).toContain(fr.contactTitle);
    const whatsapp = hrefs(html).find((href) => href.startsWith(WIDGET.href))!;
    expect(new URL(whatsapp.replaceAll("&amp;", "&")).searchParams.get("text")).toBe(fr.waPrefillGeneralDefault);
    expect(html).toContain(fr.waCtaDefault);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["tel:0551234567", "mailto:bonjour@boutique.dz"]));
    expect(html).toContain("Bab Ezzouar, Alger");
    expect(html).not.toContain('class="contact-none"');
  });

  it("leaves out what the store has not set, and says so when it has set nothing", async () => {
    const { html } = await render("contact-main", { config: { contact: { phone: "0551234567", email: null, address: null } } });
    expect(hrefs(html)).not.toContain(expect.stringContaining("wa.me"));
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain(fr.contactAddress);
    const bare = await render("contact-main");
    expect(bare.html).toContain('class="contact-none"');
  });

  it("shows the merchant's hours and note in the page's language, and none the merchant did not write", async () => {
    const written = await render("contact-main", { props: { hours: { ar: "من السبت إلى الخميس", fr: "Du samedi au jeudi, 9 h – 18 h" }, note: { fr: "Fermé les jours fériés." } } });
    expect(written.html).toContain(fr.contactHours);
    expect(written.html).toContain("Du samedi au jeudi, 9 h – 18 h");
    expect(written.html).toContain("Fermé les jours fériés.");
    expect(written.html).not.toContain("من السبت");
    const unwritten = await render("contact-main");
    expect(unwritten.html).not.toContain(fr.contactHours);
  });

  it("lists the store's pages beneath, unless the merchant hides them", async () => {
    const pages: StoreConfig["pages"] = [{ id: "p1", kind: "shipping", slug: "livraison", title: "Livraison", position: 1 }];
    expect(hrefs((await render("contact-main", { config: { pages } })).html)).toContain("/fr/pages/livraison");
    expect(hrefs((await render("contact-main", { config: { pages }, props: { showStorePages: false } })).html)).not.toContain("/fr/pages/livraison");
  });
});

describe("the search page", () => {
  it("lists what the platform finds for the shopper's words", async () => {
    const found = [makeProduct({ id: "p1", name: "Robe kabyle", handle: "robe-kabyle" })];
    const { html, searched } = await render("search-main", { params: { q: "  robe ", surface: "search" }, found });
    expect(searched).toEqual(["robe"]);
    expect(html).toContain("Robe kabyle");
    expect(hrefs(html)).toContain("/fr/products/robe-kabyle");
  });

  it("asks nothing for no words, and says how to search", async () => {
    const { html, searched } = await render("search-main", { params: { surface: "search" } });
    expect(searched).toEqual([]);
    expect(html).toContain(fr.searchHint);
    expect(html).toContain('action="/fr/search"');
  });
});

describe("the order-tracking page", () => {
  it("asks for the order's number and phone, with the merchant's title", async () => {
    const { html } = await render("track-order-main", { props: { trackTitle: "Où est ma commande ?" } });
    expect(html).toContain("Où est ma commande ?");
    expect(html).toContain('name="orderNumber"');
    expect(html).toContain('name="phone"');
  });
});

describe("the checkout page", () => {
  it("renders the basket's order form, with its checkout key and the merchant's title", async () => {
    const { html } = await render("checkout-main", { props: { checkoutTitle: "Finaliser" }, config: { cartEnabled: true } });
    expect(html).toContain("Finaliser");
    expect(html).toMatch(/<form[^>]*data-checkout/);
    expect(html).toContain('id="checkout-root"');
  });
});
