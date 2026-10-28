/**
 * The words of the Media glossary (CONTEXT.md) that the schema and every
 * module share. A Media Host is added here, then given its adapter in
 * `hosts/`; a Media Delivery kind here, then given its resize builder in
 * `@wocart/storefront`.
 */

export const MEDIA_HOSTS = ["imagekit", "r2"] as const;
export type MediaHostKind = (typeof MEDIA_HOSTS)[number];

export const MEDIA_DELIVERY_KINDS = ["imagekit", "cloudflare", "direct"] as const;
export type MediaDeliveryKind = (typeof MEDIA_DELIVERY_KINDS)[number];

export const MEDIA_KINDS = ["image", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ["pending", "ready"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** How the API returns any image. */
export interface MediaImage {
  key: string;
  url: string;
  width: number | null;
  height: number | null;
}
