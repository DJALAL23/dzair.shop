/**
 * The theme's image service: `@wocart/theme/image-service` bound to the
 * store's media domain — the one binding point for `<Image>`, as
 * `utils/images.ts` is for the image helpers.
 *
 * Every media-domain image is resized by Cloudflare on the media domain, on
 * either host (Cloudflare or Vercel); unset `MEDIA_DOMAIN` passes every image
 * through. Read per image, so one build serves every store.
 */
import { MEDIA_DOMAIN } from "astro:env/server";
import { mediaImageService } from "@wocart/theme/image-service";

export default mediaImageService(() => MEDIA_DOMAIN);
