// @vitest-environment node
/**
 * What a product card's name says. A screen reader hears the card's label, and
 * the badge and order button that show a card's status are hidden from it, so
 * the label carries the status: sold out, or the quick order. Its price reads
 * as the card shows it.
 */
/// <reference types="vitest/globals" />

import { testLocals } from "../../../__tests__/support/locals";
import { Window } from "happy-dom";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { productFixture } from "../../../__tests__/support/product";
import ProductCard from "../ProductCard.astro";
import { productCardCopy } from "@/theme/bridges/island-props";
import { en } from "@/theme/content/en";
import { formatAmount } from "@/theme/utils/money";

async function render(props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(ProductCard, {
    locals: testLocals(),
    props: { currencySymbol: "DA", copy: productCardCopy(en), ...props },
  });
  const document = new Window().document as unknown as Document;
  document.body.innerHTML = html;
  return document;
}

const label = (doc: Document) => doc.querySelector("a.product-card")!.getAttribute("aria-label")!;
const shownPrice = (doc: Document) => doc.querySelector(".card-price")!.textContent!.replace(/\s+/g, "");

describe("a product card's name", () => {
  it("is the product, its price, and the quick order the card shows", async () => {
    const doc = await render({ product: productFixture(), action: true });
    expect(label(doc)).toBe(`Casque Bluetooth - ${formatAmount(4500)}DA, ${en.orderCta}`);
  });

  it("leaves the order out where the card has no quick order", async () => {
    const doc = await render({ product: productFixture(), action: false });
    expect(label(doc)).toBe(`Casque Bluetooth - ${formatAmount(4500)}DA`);
  });

  it("says a sold-out product is sold out, and offers no order", async () => {
    const doc = await render({ product: productFixture({ inventory: 0, trackInventory: true }), action: true });
    expect(label(doc)).toBe(`Casque Bluetooth - ${formatAmount(4500)}DA, ${en.outOfStock}`);
    expect(label(doc)).not.toContain(en.orderCta);
  });

  it("gives the price as the card shows it, so the words a reader hears are the words on the card", async () => {
    const doc = await render({ product: productFixture(), action: false });
    expect(label(doc)).toContain(shownPrice(doc));
  });
});
