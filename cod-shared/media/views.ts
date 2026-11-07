/**
 * How the API shows stored images: every row that holds a Media Key becomes
 * a MediaImage with the store's URL for it. A row without a key — an image of
 * another site, from before Media Keys — is not shown.
 */
import type { landingPageImages, productCategories, productImages } from "../db/schema";
import { mediaImage, type MediaDelivery } from "./delivery";
import type { MediaImage } from "./model";
import { toServedHtml } from "./rich-text";

/** An image a column holds by key, with the size when the row knows it. */
export function imageOf(key: string | null | undefined, delivery: MediaDelivery, size: { width?: number | null; height?: number | null } = {}): MediaImage | null {
  return key ? mediaImage({ key, width: size.width ?? null, height: size.height ?? null }, delivery) : null;
}

/** The image a `json_object('key', …, 'width', …, 'height', …)` subquery picked, or null. */
export function firstImage(json: string | null, delivery: MediaDelivery): MediaImage | null {
  if (!json) return null;
  const { key, width, height } = JSON.parse(json) as { key: string | null; width: number | null; height: number | null };
  return imageOf(key, delivery, { width, height });
}

export interface ProductImageView extends MediaImage {
  id: string;
  productId: string;
  altText: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

type ProductImageRow = typeof productImages.$inferSelect;

export function productImageView(row: ProductImageRow | null, delivery: MediaDelivery): ProductImageView | null {
  if (!row?.mediaKey) return null;
  return {
    id: row.id,
    productId: row.productId,
    ...mediaImage({ key: row.mediaKey, width: row.width, height: row.height }, delivery),
    altText: row.altText,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function productImageViews(rows: readonly ProductImageRow[], delivery: MediaDelivery): ProductImageView[] {
  return rows.flatMap((row) => productImageView(row, delivery) ?? []);
}

type CategoryRow = typeof productCategories.$inferSelect;

/** A category as the API shows it: its image, resolved from its key. */
export function categoryView<T extends CategoryRow>(row: T, delivery: MediaDelivery): Omit<T, "imageKey"> & { image: MediaImage | null } {
  const { imageKey, ...rest } = row;
  return { ...rest, image: imageOf(imageKey, delivery) };
}

/** A description as a browser reads it: an HTML one shows its `media:` keys at their URLs. */
export function servedDescription(description: string | null, format: "text" | "html" | undefined, delivery: MediaDelivery): string | null {
  return description !== null && format === "html" ? toServedHtml(description, delivery) : description;
}

type LandingImageRow = typeof landingPageImages.$inferSelect;

export interface LandingImageView extends MediaImage {
  id: string;
  landingPageId: string;
  altText: string | null;
  source: LandingImageRow["source"];
  position: number;
  createdAt: string;
}

export function landingImageViews(rows: readonly LandingImageRow[], delivery: MediaDelivery): LandingImageView[] {
  return rows.map((row) => ({
    id: row.id,
    landingPageId: row.landingPageId,
    ...mediaImage({ key: row.mediaKey, width: row.width, height: row.height }, delivery),
    altText: row.altText,
    source: row.source,
    position: row.position,
    createdAt: row.createdAt,
  }));
}
