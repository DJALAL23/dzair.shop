// @vitest-environment node
/// <reference types="vitest/globals" />

import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import WhatsAppWidget from "../WhatsAppWidget.astro";
import StoreLayout from "@/theme/layouts/StoreLayout.astro";
import type { StoreContext } from "@/theme/runtime/store";
import { en as enContent } from "@/theme/content/en";
import { TEST_CONFIG } from "@/theme/__tests__/support/locals";
import type { StoreWhatsAppWidget, StoreConfig } from "@wocart/storefront";
import { storeWhatsApp } from "@/theme/utils/whatsapp";

const BASE_WIDGET: StoreWhatsAppWidget = {
  href: "https://wa.me/213551234567",
  agentName: null,
  caption: null,
  avatarUrl: null,
  welcomeMessage: null,
  launcherLabel: null,
  ctaLabel: null,
  prefillGeneral: null,
  prefillProduct: null,
  prefillThankYou: null,
  thankYouButtonLabel: null,
  accent: "whatsapp",
  position: "right",
  attention: true,
  surfaces: {
    home: true,
    catalog: true,
    product: true,
    pages: true,
    thankYou: true,
    checkout: false,
    landing: false,
  },
};

const BASE_CONFIG: StoreConfig = {
  ...TEST_CONFIG,
  id: "store-test",
  name: "Boutique Dz",
};

async function renderWidget(widgetPartial: Partial<StoreWhatsAppWidget> = {}, configPartial: Partial<StoreConfig> = {}) {
  const container = await AstroContainer.create();
  const widget: StoreWhatsAppWidget = { ...BASE_WIDGET, ...widgetPartial };
  const config: StoreConfig = { ...BASE_CONFIG, ...configPartial };

  const contact = storeWhatsApp({ config: { ...config, whatsapp: widget }, content: enContent }, { kind: "general", url: "https://example.dz/" })!;
  const html = await container.renderToString(WhatsAppWidget, {
    props: {
      contact,
      content: enContent,
      config,
    },
  });

  const window = new Window();
  window.document.body.innerHTML = html;
  return { html, document: window.document };
}

async function renderLayout(pathname: string, config: StoreConfig, props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  const store: StoreContext = {
    config,
    content: enContent,
    locale: "en",
    fallbackLocales: [],
    isRTL: false,
    // A store with no menus and no saved pages: the header and footer are the theme's.
    client: { menus: { get: async () => null }, pageData: { get: async () => null } } as never,
    routing: { primary: "en", published: ["en"] },
    pathname: new URL(`https://example.dz${pathname}`).pathname,
    href: (path) => path,
  };
  const html = await container.renderToString(StoreLayout, {
    // StoreLayout reads the store context from `Astro.locals.store` — set by
    // middleware in production (Theme Zero S2). The Container API takes
    // `locals` directly, so the seam stays testable. The cast satisfies the
    // full `App.Locals` shape: the Cloudflare adapter adds a required
    // `cfContext` that the layout never touches; `store` itself is typed.
    locals: { store } as unknown as App.Locals,
    request: new Request(`https://example.dz${pathname}`),
    props,
  });

  const window = new Window();
  window.document.body.innerHTML = html;
  return { html, document: window.document };
}

describe("WhatsAppWidget component markup & accessibility", () => {
  it("renders launcher and hidden panel with proper accessibility attributes", async () => {
    const { document } = await renderWidget();

    const launcher = document.getElementById("wa-launcher");
    expect(launcher).not.toBeNull();
    expect(launcher?.getAttribute("aria-expanded")).toBe("false");
    expect(launcher?.getAttribute("aria-controls")).toBe("wa-panel");
    expect(launcher?.getAttribute("aria-label")).toBe(enContent.waOpenChat);

    const panel = document.getElementById("wa-panel");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("false");
    expect(panel?.hasAttribute("hidden")).toBe(true);

    const closeBtn = document.getElementById("wa-close");
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute("aria-label")).toBe(enContent.waCloseChat);

    const cta = document.getElementById("wa-cta");
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute("target")).toBe("_blank");
    expect(cta?.getAttribute("rel")).toContain("noopener");
  });

  it("falls back to store name and content defaults when identity fields are null", async () => {
    const { document } = await renderWidget(
      { agentName: null, caption: null, welcomeMessage: null, ctaLabel: null },
      { name: "My Alger Store" },
    );

    const title = document.getElementById("wa-panel-title");
    expect(title?.textContent?.trim()).toBe("My Alger Store");

    const caption = document.querySelector(".wa-caption");
    expect(caption?.textContent?.trim()).toBe(enContent.waCaptionDefault);

    const bubble = document.querySelector(".wa-bubble-text");
    expect(bubble?.textContent?.trim()).toBe(enContent.waWelcomeDefault);

    const cta = document.querySelector(".wa-cta-label");
    expect(cta?.textContent?.trim()).toBe(enContent.waCtaDefault);
  });

  it("escapes merchant-authored text safely as text nodes only (never HTML)", async () => {
    const evilScript = '<script id="evil">alert("xss")</script><b>Bold Merchant</b>';
    const { document } = await renderWidget({
      agentName: evilScript,
      welcomeMessage: evilScript,
    });

    // The script tag must NEVER be parsed into a DOM element
    expect(document.getElementById("evil")).toBeNull();
    expect(document.querySelector("script#evil")).toBeNull();

    const title = document.getElementById("wa-panel-title");
    expect(title?.textContent).toContain('<script id="evil">');
  });

  it("renders avatar image when avatarUrl is provided", async () => {
    const { document } = await renderWidget({ avatarUrl: "https://cdn.example.com/avatar.jpg" });
    const img = document.querySelector(".wa-header-avatar img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/avatar.jpg");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("falls back to the store's logo when avatarUrl is null", async () => {
    const { document } = await renderWidget(
      { avatarUrl: null },
      { logo: { key: "products/logo.png", url: "https://cdn.example.com/logo.png", width: 256, height: 256 } },
    );
    const img = document.querySelector(".wa-header-avatar img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
  });

  it("renders generic SVG avatar when there is neither an avatar nor a logo", async () => {
    const { document } = await renderWidget({ avatarUrl: null }, { logo: null });
    const img = document.querySelector(".wa-header-avatar img");
    expect(img).toBeNull();
    const fallbackSvg = document.querySelector(".wa-avatar-fallback svg");
    expect(fallbackSvg).not.toBeNull();
  });

  it("applies primary color accent when accent is 'primary'", async () => {
    const { document } = await renderWidget({ accent: "primary" });
    const launcher = document.getElementById("wa-launcher");
    expect(launcher?.getAttribute("style")).toContain("var(--clr-primary)");

    const cta = document.getElementById("wa-cta");
    expect(cta?.getAttribute("style")).toContain("var(--clr-primary)");
  });

  it("applies brand whatsapp color when accent is 'whatsapp'", async () => {
    const { document } = await renderWidget({ accent: "whatsapp" });
    const launcher = document.getElementById("wa-launcher");
    expect(launcher?.getAttribute("style")).toContain("var(--clr-whatsapp)");

    const cta = document.getElementById("wa-cta");
    expect(cta?.getAttribute("style")).toContain("var(--clr-whatsapp-deep)");
  });
});

describe("StoreLayout surface gating and off state", () => {
  it("renders NO widget markup when config.whatsapp is null", async () => {
    const config: StoreConfig = { ...BASE_CONFIG, whatsapp: null };
    const { document } = await renderLayout("/", config);
    expect(document.getElementById("wa-widget")).toBeNull();
  });

  it("renders NO widget markup on a surface that is toggled off", async () => {
    const config: StoreConfig = {
      ...BASE_CONFIG,
      whatsapp: {
        ...BASE_WIDGET,
        surfaces: { ...BASE_WIDGET.surfaces, home: false },
      },
    };
    const { document } = await renderLayout("/", config);
    expect(document.getElementById("wa-widget")).toBeNull();
  });

  it("starts a product page's chat with its product, in the theme's words when the merchant wrote none", async () => {
    const config: StoreConfig = { ...BASE_CONFIG, whatsapp: BASE_WIDGET };
    const { document } = await renderLayout("/products/robe", config, { whatsapp: { kind: "product", product: "Robe kabyle" } });
    const text = new URL(document.getElementById("wa-cta")!.getAttribute("href")!).searchParams.get("text");
    expect(text).toBe(enContent.waPrefillProductDefault.replace("{product}", "Robe kabyle").replace("{url}", "https://example.dz/products/robe"));
  });

  it("renders widget markup on an allowed surface", async () => {
    const config: StoreConfig = {
      ...BASE_CONFIG,
      whatsapp: {
        ...BASE_WIDGET,
        surfaces: { ...BASE_WIDGET.surfaces, home: true },
      },
    };
    const { document } = await renderLayout("/", config);
    expect(document.getElementById("wa-widget")).not.toBeNull();
  });
});
