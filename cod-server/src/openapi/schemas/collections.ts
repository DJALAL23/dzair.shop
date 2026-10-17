/**
 * Collection schemas: the merchant's curated product lists (`/api/collections`).
 * The storefront reads a collection through `/store/products?collection=`.
 */

import { z } from "@hono/zod-openapi";
import { COLLECTION_HANDLE_RE, COLLECTION_MAX_PRODUCTS } from "../../../../cod-shared/catalog/collections";

export const CollectionHandleSchema = z.string().regex(COLLECTION_HANDLE_RE).openapi({
  description: "Lowercase letters, digits and hyphens; how a theme names the collection",
  example: "best-sellers",
});

export const CreateCollectionSchema = z.object({
  handle: CollectionHandleSchema,
  title: z.string().trim().min(1).max(100).openapi({ example: "Best sellers" }),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const UpdateCollectionSchema = CreateCollectionSchema.partial();

export const SaveCollectionProductsSchema = z.object({
  productIds: z.array(z.string().min(1)).max(COLLECTION_MAX_PRODUCTS).openapi({
    description: `The collection's products, in order; replaces the list. At most ${COLLECTION_MAX_PRODUCTS}.`,
  }),
});

export const CollectionSummarySchema = z
  .object({
    id: z.string(),
    handle: CollectionHandleSchema,
    title: z.string(),
    productCount: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("CollectionSummary");

export const CollectionDetailSchema = z
  .object({
    id: z.string(),
    handle: CollectionHandleSchema,
    title: z.string(),
    description: z.string().nullable(),
    updatedAt: z.string(),
    products: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        handle: z.string(),
        imageUrl: z.string().nullable(),
        visible: z.boolean().openapi({ description: "Whether shoppers see it now (active, visible, listed in the store); a hidden product is left out of the storefront list" }),
      }),
    ),
  })
  .openapi("CollectionDetail");

export const StorefrontCollectionSchema = z
  .object({
    handle: CollectionHandleSchema,
    title: z.string().openapi({ description: "In the requested language when the store translated it" }),
    description: z.string().nullable(),
  })
  .openapi("StorefrontCollection");
