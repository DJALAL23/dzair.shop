/**
 * S10 (pulled forward) — the theme's ONE image binding.
 *
 * The SDK's image helpers take a media domain per call. Binding it here means
 * every component-facing helper takes only a URL, so a call site cannot forget
 * the domain and silently ship an unoptimized image — the failure mode the
 * deleted `src/core/utils/image-optimizer.ts` had no guard against.
 *
 * Rules this module encodes:
 *
 * - **Server-only.** It reads `astro:env/server`, so it may only be imported
 *   from server code (page frontmatter, components, endpoints). Browser
 *   scripts import `@wocart/storefront` directly.
 * - **Unset `MEDIA_DOMAIN` is a supported state** (local dev, a store without
 *   a CDN): every helper passes the original URL through unchanged, so callers
 *   never branch on it.
 * - **One binding point.** A helper missing here is a bug in this file, not a
 *   reason to re-implement it — `createImageHelpers` is the SDK's contract.
 */
import { createImageHelpers, mediaUrl } from "@wocart/storefront";
import { MEDIA_DOMAIN } from "astro:env/server";

const images = createImageHelpers(MEDIA_DOMAIN);

/**
 * The URL of an image the merchant chose in the editor: an `image` field
 * stores the object's key in the store's media, never a URL. `null` without a
 * media domain (local dev with no CDN): the section renders without it.
 */
export const mediaKeyUrl = (key: string): string | null => mediaUrl(key, MEDIA_DOMAIN);

export const optimizeImage = images.optimizeImage;
export const generateSrcSet = images.generateSrcSet;
export const IMAGE_SIZES = images.IMAGE_SIZES;
export const getCardImage = images.getCardImage;
export const getGalleryImage = images.getGalleryImage;
export const getThumbnailImage = images.getThumbnailImage;
export const getHeroImage = images.getHeroImage;
export const getCategoryImage = images.getCategoryImage;
export const getLogoImage = images.getLogoImage;
