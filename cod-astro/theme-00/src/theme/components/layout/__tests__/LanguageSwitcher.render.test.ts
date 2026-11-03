// @vitest-environment node
// Must run in the node environment — see ProductDescription.render.test.ts.
/**
 * The language menu: each published language as a link to this same page,
 * none while the store serves one language, and none on a landing page — a
 * landing page exists in the store's primary language only, and the SDK
 * sends `/fr/lp/…` back to `/lp/…`.
 */
/// <reference types="vitest/globals" />

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import LanguageSwitcher from "@/theme/components/layout/LanguageSwitcher.astro";
import { testStore, TEST_CONFIG } from "../../../__tests__/support/locals";

const config = { ...TEST_CONFIG, locales: [...TEST_CONFIG.locales, { code: "fr", nativeName: "Français", direction: "ltr" as const }] };
const routing = { primary: "ar", published: ["ar", "fr"] };

async function render(pathname: string, published = routing.published) {
  const container = await AstroContainer.create();
  return container.renderToString(LanguageSwitcher, {
    locals: { store: testStore({ config, routing: { ...routing, published }, locale: "ar", pathname }) } as unknown as App.Locals,
    request: new Request(`https://boutique.test${pathname}`),
  });
}

describe("LanguageSwitcher", () => {
  it("links this same page in each published language", async () => {
    const html = await render("/products/robe");
    expect(html).toContain('href="/fr/products/robe"');
    expect(html).toContain('href="/products/robe"');
  });

  it("is absent while the store serves one language", async () => {
    expect(await render("/products/robe", ["ar"])).not.toContain("lang-trigger");
  });

  it("is absent on a landing page, which exists in the primary language only", async () => {
    const html = await render("/lp/summer");
    expect(html).not.toContain("lang-trigger");
    expect(html).not.toContain("/fr/lp/");
  });
});
