/**
 * The theme's ONE image binding: the SDK's helpers, at the sizes this theme
 * shows, taking the store's media delivery (`Astro.locals.store.config.media`).
 *
 * - **Server-only callers.** Pages and components pass the request's config;
 *   browser scripts never import this module.
 * - **A photo that cannot be resized keeps its URL** (a `direct` delivery,
 *   local development): callers never branch on it.
 * - **One binding point.** A size missing here is added here, not rebuilt in
 *   a component.
 */
import { mediaImageSrcset, mediaImageUrl, pictureOf, type MediaDelivery, type PickedImage, type Picture } from "@wocart/storefront";

const THUMBNAIL = { width: 80, height: 80, fit: "cover", format: "auto", quality: 80 } as const;
const QUALITY = 82;

/** A photo at a width, in its own shape. */
export const imageSource = (src: string, media: MediaDelivery, width: number): string =>
  mediaImageUrl(src, { width, fit: "scale-down", format: "auto", quality: QUALITY }, media) ?? src;

/** The same photo at several widths, so a phone downloads a phone-sized file; undefined when it cannot be resized. */
export const imageSrcset = (src: string, media: MediaDelivery, widths: readonly number[]): string | undefined =>
  mediaImageSrcset(src, widths, { delivery: media, quality: QUALITY }) ?? undefined;

/** A product's cart thumbnail. */
export const thumbnailImage = (src: string, media: MediaDelivery): string => mediaImageUrl(src, THUMBNAIL, media) ?? src;

/**
 * An image the merchant chose in the editor, ready to show: an `image` field
 * stores the image's Media Key, never a URL; this gives its URL, alt text and
 * `object-position` from its focal point.
 */
export const pickedPicture = (image: PickedImage | null | undefined, media: MediaDelivery): Picture | null => pictureOf(image, media);
