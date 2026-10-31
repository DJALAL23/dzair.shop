/**
 * Copy *picks* — the keys a component actually renders.
 *
 * A component declares the copy it needs and nothing more. Two reasons this
 * matters beyond tidiness:
 *
 * 1. **Server islands pay for their props.** Astro encrypts island props into
 *    the island request URL; the browser caps URLs at 2048 bytes and, past the
 *    cap, Astro switches to a POST — which is not cacheable (see
 *    docs.astro.build → Server islands → Caching). The full pack measures
 *    ~8.5 KB, so any island taking `content` falls off the cacheable path.
 *    `server-islands.test.ts` pins both numbers.
 * 2. **The interface is the contract.** `ReviewsIslandCopy` tells the next
 *    author exactly which strings the island renders — no more "pass the whole
 *    pack and hope".
 *
 * `pickCopy` keeps the pick honest at every call site: the value it returns is
 * typed to exactly the keys requested.
 */
import { pluralKeys } from "../content/messages";
import type { StoreFrontContent } from "../content/types";

/** Keep only `keys`, typed to exactly those keys (all pack values are strings). */
export function pickCopy<const K extends readonly (keyof StoreFrontContent)[]>(
  content: StoreFrontContent,
  keys: K,
): Pick<StoreFrontContent, K[number]> {
  const picked = {} as Pick<StoreFrontContent, K[number]>;
  for (const key of keys) {
    // A plural form the language does not use is absent from its pack.
    if (content[key] !== undefined) (picked as Record<string, string>)[key] = content[key]!;
  }
  return picked;
}

// ── Product card ─────────────────────────────────────────────────────────────

export const PRODUCT_CARD_KEYS = [
  "orderCta",
  "outOfStock",
  ...pluralKeys("lowStock"),
  "ariaProductCard",
  "ariaProductCardAction",
] as const;

export type ProductCardCopy = Pick<StoreFrontContent, (typeof PRODUCT_CARD_KEYS)[number]>;

export const productCardCopy = (content: StoreFrontContent): ProductCardCopy =>
  pickCopy(content, PRODUCT_CARD_KEYS);

// ── Related products (island) ────────────────────────────────────────────────
// The island renders its own heading and passes a card pick down to
// ProductCard, so the island's pick is the union of both.

export const RELATED_PRODUCTS_KEYS = [
  "relatedTitle",
  "relatedSub",
  ...PRODUCT_CARD_KEYS,
] as const;

export type RelatedProductsCopy = Pick<StoreFrontContent, (typeof RELATED_PRODUCTS_KEYS)[number]>;

export const relatedProductsCopy = (content: StoreFrontContent): RelatedProductsCopy =>
  pickCopy(content, RELATED_PRODUCTS_KEYS);

// ── Reviews (island: the list) ───────────────────────────────────────────────
// The review form renders with the product page, not in the island: it needs
// no request data, and its copy would not fit the island's URL.

export const REVIEWS_LIST_KEYS = [
  ...pluralKeys("ariaStarRating"),
  "reviewsVerifiedBuyer",
  "reviewsVoiceNote",
  "reviewsPlayVoice",
  "reviewsPauseVoice",
  "reviewsSeekVoice",
  "reviewsVoicePosition",
  "reviewsVoiceError",
  "reviewsVoiceRetry",
  "reviewsOpenPhoto",
  "reviewsClosePhoto",
  "loadMoreLabel",
] as const;

export type ReviewsListCopy = Pick<StoreFrontContent, (typeof REVIEWS_LIST_KEYS)[number]>;

/** The island renders the list only. */
export const REVIEWS_ISLAND_KEYS = REVIEWS_LIST_KEYS;

export type ReviewsIslandCopy = Pick<StoreFrontContent, (typeof REVIEWS_ISLAND_KEYS)[number]>;

export const reviewsIslandCopy = (content: StoreFrontContent): ReviewsIslandCopy =>
  pickCopy(content, REVIEWS_ISLAND_KEYS);

// ── Product page-data bridge ─────────────────────────────────────────────────
// The labels the bridge carries from SSR into the product scripts — see
// theme/bridges/product-page-data.ts. Everything else those scripts need is
// already markup (buttons, labels, hints) that they leave alone when unsure.

export const PAGE_DATA_KEYS = [
  "formPhoneInvalid",
  "outOfStock",
  ...pluralKeys("qtyMaxStock"),
  "shippingCalculated",
  "shippingFree",
  "shippingUnavailable",
  "formCommunePlaceholder",
  "formCommuneLoading",
  "formCommuneDisabled",
] as const;

export type PageDataCopy = Pick<StoreFrontContent, (typeof PAGE_DATA_KEYS)[number]>;

export const pageDataCopy = (content: StoreFrontContent): PageDataCopy =>
  pickCopy(content, PAGE_DATA_KEYS);
