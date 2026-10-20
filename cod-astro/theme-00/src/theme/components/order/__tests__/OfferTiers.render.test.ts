// @vitest-environment node
/**
 * What the offer tiles say. Every tile states how many pieces it sells, read
 * from the data and never from the offer's name, and a free reward of more than
 * one unit says so. Arabic uses the language's own plural forms.
 */
/// <reference types="vitest/globals" />

import { testLocals } from "../../../__tests__/support/locals";
import { Window } from "happy-dom";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { OfferSchema, type Offer } from "@wocart/storefront";
import { productFixture as product } from "../../../__tests__/support/product";
import OfferTiers from "../OfferTiers.astro";
import { en } from "@/theme/content/en";
import { ar } from "@/theme/content/ar";

/** Built through the SDK's own schema, so the fixture cannot drift from the storefront contract. */
function offer(overrides: Partial<Offer> = {}): Offer {
  return OfferSchema.parse({
    id: "offer_1",
    name: "عرض",
    discountType: "free",
    triggerQuantity: 3,
    triggerVariantId: null,
    rewardQuantity: 1,
    rewardProductId: "prod_1",
    rewardProductName: "Casque Bluetooth",
    rewardVariantId: null,
    rewardVariantLabel: null,
    rewardUnitPrice: 4500,
    ...overrides,
  });
}

async function render(props: Record<string, unknown>, locale: "en" | "ar" = "en") {
  const container = await AstroContainer.create();
  const html = await container.renderToString(OfferTiers, {
    locals: testLocals(locale === "ar" ? { locale, isRTL: true, routing: { primary: "ar", published: ["ar"] }, content: ar } : {}),
    props: {
      product: product(),
      offers: [],
      basePrice: 4500,
      comparePrice: null,
      cur: "DA",
      isRTL: locale === "ar",
      content: locale === "ar" ? ar : en,
      defaultVariantId: null,
      ...props,
    },
  });
  const document = new Window().document;
  document.body.innerHTML = html;
  return document;
}

const text = (element: { textContent: string | null } | null) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("an offer tile", () => {
  it("states the pieces it sells from the trigger quantity, whatever the offer is named", async () => {
    const doc = await render({ offers: [offer({ triggerQuantity: 3, name: "عرض" })] });
    expect(text(doc.querySelector("#tier-card-offer_1 .tier-qty"))).toBe("3 pieces");
  });

  it("says how many units a free reward gives when that is more than one", async () => {
    const doc = await render({ offers: [offer({ triggerQuantity: 3, rewardQuantity: 2, rewardProductName: "Logitech" })] });
    expect(text(doc.querySelector("#tier-card-offer_1 .tier-reward"))).toBe("2 × Logitech · Free");
  });

  it("names a single free unit without a count", async () => {
    const doc = await render({ offers: [offer({ rewardQuantity: 1, rewardProductName: "Casque" })] });
    expect(text(doc.querySelector("#tier-card-offer_1 .tier-reward"))).toBe("Casque · Free");
  });

  it("gives the base tile its one piece", async () => {
    const doc = await render({ offers: [offer()] });
    expect(text(doc.querySelector("#tier-card-base .tier-qty"))).toBe("1 piece");
  });
});

describe("a quantity tier", () => {
  it("states its pieces beside its per-unit price", async () => {
    const doc = await render({
      product: product({
        quantityPricing: {
          offerId: "qp_1",
          name: "Bundle",
          triggerVariantId: null,
          tiers: [
            { quantity: 2, price: 8000, freeShipping: false },
            { quantity: 3, price: 11000, freeShipping: true },
          ],
        },
      }),
    });
    const tiles = [...doc.querySelectorAll(".qty-tier")];
    expect(tiles.map((tile) => text(tile.querySelector(".tier-qty")))).toEqual(["1 piece", "2 pieces", "3 pieces"]);
    expect(tiles[2]!.textContent).toContain("Free Shipping");
  });
});

describe("the same tiles in Arabic", () => {
  it("uses the language's own forms for two pieces and for a few", async () => {
    const doc = await render({ offers: [offer({ triggerQuantity: 2 }), offer({ id: "offer_2", triggerQuantity: 3 })] }, "ar");
    expect(text(doc.querySelector("#tier-card-offer_1 .tier-qty"))).toBe("قطعتان");
    expect(text(doc.querySelector("#tier-card-offer_2 .tier-qty"))).toBe("3 قطع");
  });
});
