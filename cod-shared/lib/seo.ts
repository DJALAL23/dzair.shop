/**
 * The lengths a search-engine title and description may have, wherever a
 * merchant writes one (a product, a category): about what a search result
 * shows before it cuts the text. Mirrored by `@wocart/storefront`
 * (`SEO_TEXT_LIMITS`), which shortens a fallback description to the same.
 */
export const SEO_TEXT = { titleMax: 60, descriptionMax: 160 } as const;
