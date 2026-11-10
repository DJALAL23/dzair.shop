// @vitest-environment node
// Must run in node: under happy-dom the Astro plugin resolves `.astro` imports
// to the browser stub, which throws instead of rendering.
/// <reference types="vitest/globals" />
/**
 * OrderForm's `secondary-action` slot — the one real slot in theme-00.
 *
 * `ProductOrder` fills it with the Add-to-Cart button when, and only
 * when, the merchant has the cart enabled; the slot's whole purpose is that the
 * secondary order action sits *directly under* the confirm button, inside the
 * card, so the two actions read as one decision.
 *
 * That claim is about markup and position, so it is tested against the real
 * component through the Container API. `secondary-action` previously appeared
 * in exactly two files — both source — and no test mentioned it: the only
 * slot-shaped behaviour in the reference theme was unverified.
 *
 * This is an **Astro** slot (`<slot name="…" />`), not a CodFlow composition
 * slot (`SlotDefinition`). The difference is who decides what goes in it: here
 * the theme's own markup decides, which is why a merchant can never drop a Hero
 * into the checkout card. A composition slot is for the cases where the
 * merchant decides — and theme-00 has none.
 */
import { testLocals } from "../../../__tests__/support/locals";
import { describe, expect, it, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { ProductSchema, type ProductDetail } from "@wocart/storefront";
import OrderForm from "../OrderForm.astro";
import { en as enContent } from "@/theme/content/en";

// `astro:actions` is a virtual module that only exists inside an Astro project.
// OrderForm uses it exactly once — the form's action attribute — so the mock
// carries that one shape and nothing else.
vi.mock("astro:actions", () => ({
  actions: { placeOrder: "/_actions/placeOrder" },
}));

/** Built through the SDK's own schema, so the fixture cannot drift from the catalog contract. */
function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return ProductSchema.parse({
    id: "prod_1",
    name: "Casque Bluetooth",
    description: null,
    descriptionFormat: "text",
    descriptionPlain: null,
    handle: "casque-bluetooth",
    currency: "DZD",
    price: 4500,
    compareAtPrice: null,
    type: "PHYSICAL",
    hasVariants: false,
    sku: null,
    inventory: 10,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    variantOptions: null,
    tags: [],
    metaTitle: null,
    metaDescription: null,
    category: null,
    variants: [],
    images: [],
    reviewStats: null,
    quantityPricing: null,
    offers: [],
    ...overrides,
  });
}

/** What ProductOrder actually passes in: the Add-to-Cart button. */
const SECONDARY = '<span data-testid="secondary-action">Add to cart</span>';

async function render(slots?: Record<string, string>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(OrderForm, {
    locals: testLocals(),
    props: {
      product: product(),
      content: enContent,
      fieldErrors: {},
      notice: null,
      basePrice: 4500,
      defaultVariant: null,
      cur: "DZD",
      isRTL: false,
      offers: [],
      defaultVariantId: null,
    },
    ...(slots === undefined ? {} : { slots }),
  });
}

describe("OrderForm — the secondary-action slot", () => {
  it("renders what the parent fills it with, directly under the confirm button", async () => {
    const html = await render({ "secondary-action": SECONDARY });

    const submitAt = html.indexOf('id="submit-btn"');
    const secondaryAt = html.indexOf('data-testid="secondary-action"');
    const noteAt = html.indexOf(enContent.formConfirmNote);

    expect(secondaryAt).toBeGreaterThan(-1);
    expect(html).toContain("Add to cart");
    // The three anchors must all exist for the ordering to mean anything.
    expect(submitAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(-1);
    // Asserted, not assumed: after confirming, before the confirmation note.
    expect(secondaryAt).toBeGreaterThan(submitAt);
    expect(secondaryAt).toBeLessThan(noteAt);
    // And inside the form, never floating outside the card.
    expect(secondaryAt).toBeLessThan(html.indexOf("</form>"));
  });

  it("renders the form intact when nothing fills the slot", async () => {
    const html = await render();

    expect(html).not.toContain("secondary-action");
    // The wrapper is present and collapses: `empty:hidden` is what stops an
    // unfilled slot leaving a gap in the card.
    expect(html).toContain("empty:hidden");
    // The rest of the form is untouched — the primary action is the form.
    expect(html).toContain('id="submit-btn"');
    expect(html).toContain(enContent.formConfirmNote);
  });

  it("only accepts content under its own name — the default slot is not a back door", async () => {
    // If this ever rendered, a parent could smuggle arbitrary markup into the
    // order card without the theme's own markup deciding to allow it.
    const html = await render({ default: SECONDARY });

    expect(html).not.toContain("secondary-action");
    expect(html).not.toContain("Add to cart");
  });
});