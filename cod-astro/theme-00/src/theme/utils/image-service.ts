/**
 * The theme's image service: `@wocart/theme/image-service` bound to the
 * store's media delivery — the one binding point for `<Image>`, as
 * `utils/images.ts` is for the image helpers.
 *
 * Astro asks the service for a URL without the request, so the store context
 * keeps the delivery of every config it reads (`keepStoreMedia`) and the
 * service reads the last one kept. The theme's fallback config is never kept:
 * a failed read leaves the last delivery known. Before any is known every
 * image passes through.
 */
import type { MediaDelivery } from "@wocart/storefront";
import { mediaImageService } from "@wocart/theme/image-service";

let storeMedia: MediaDelivery | null = null;

export function keepStoreMedia(media: MediaDelivery): void {
  storeMedia = media;
}

export default mediaImageService(() => storeMedia);
