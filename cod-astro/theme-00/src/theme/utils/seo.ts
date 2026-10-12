import type { ProductDetail } from "@codflow/storefront";
import { getProductView } from "@codflow/storefront";

/** The territories this theme's shoppers are in, per language. */
const OPEN_GRAPH_LOCALES: ReadonlyMap<string, string> = new Map([
  ["ar", "ar_DZ"],
  ["fr", "fr_DZ"],
  ["en", "en_US"],
]);

/**
 * `og:locale` for the language a page is rendered in (language_TERRITORY). A
 * language this theme has no territory for keeps its own tag, underscored.
 */
export function openGraphLocale(locale: string): string {
  return OPEN_GRAPH_LOCALES.get(locale) ?? locale.replace(/-/g, "_");
}

/**
 * The description to use in metadata (JSON-LD, og:description).
 *
 * A rich description is stored as sanitised HTML — correct for the page, wrong
 * for metadata, where tags must never appear. The platform ships
 * `descriptionPlain` (tags stripped, entities decoded) for exactly this.
 * Fallbacks, in order:
 *   1. `descriptionPlain` — authoritative when present.
 *   2. legacy `text` rows → the stored text (it is plain by definition).
 *   3. an `html` row with no `descriptionPlain` → `undefined`, so markup can
 *      never leak into structured data.
 */
export function productMetaDescription(product: ProductDetail): string | undefined {
  if (product.descriptionPlain) return product.descriptionPlain;
  if (product.descriptionFormat === "html") return undefined;
  return product.description ?? undefined;
}

export function getProductJsonLd(product: ProductDetail, basePrice: number) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: productMetaDescription(product),
    image: product.images.map((i) => i.src),
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency,
      price: basePrice,
      availability: getProductView(product).isOutOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
    },
  };
}
