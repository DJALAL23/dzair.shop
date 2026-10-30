import { OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { products } from "../../../../cod-shared/db/schema";
import { registerTranslationRoutes } from "../translations/routes";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as h from "./handlers";
import * as vh from "../variants/handlers";
import * as ih from "./images";
import {
  createProductSchema,
  updateProductSchema,
  updateStatusSchema,
  productFiltersSchema,
} from "./validation";
import { createVariantSchema, updateVariantSchema } from "../variants/validation";
import {
  ProductSchema,
  ProductDetailSchema,
  ProductImageSchema,
  MediaKeySchema,
  ProductVariantSchema,
  ProductRemovalSchema,
  SuccessResponseSchema,
  ListResponseSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const idParams = z.object({
  id: z.string().openapi({ description: "Product ID", example: "prod_abc123" }),
});

const productIdParams = z.object({
  productId: z.string().openapi({ description: "Product ID", example: "prod_abc123" }),
});

const variantIdParams = productIdParams.extend({
  variantId: z.string().openapi({ description: "Variant ID", example: "var_abc123" }),
});

const imageIdParams = idParams.extend({
  imageId: z.string().openapi({ description: "Image ID", example: "img_abc123" }),
});

// ─── Products ─────────────────────────────────────────────────────────────────

const listProductsRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "List products",
  description:
    "Returns a paginated list of products. Soft-deleted products are never returned. Each item includes `variantsCount`, `totalInventory`, `primaryImage` (its gallery's first image), and `variants` array.",
  operationId: "listProducts",
  query: productFiltersSchema,
  responses: {
    200: {
      description: "List of products",
      content: jsonContent(ListResponseSchema(ProductSchema)),
    },
  },
  handler: h.listProducts,
});

const createProductRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Create product",
  description:
    "Creates a product. SKU rules: simple products (`hasVariants=false`, the default) must include `sku`. Variant products (`hasVariants=true`) must omit `sku` here — set it on each variant instead. Returns the full product record including empty `variants` and `images` arrays.",
  operationId: "createProduct",
  body: createProductSchema,
  responses: {
    201: {
      description: "Product created",
      content: jsonContent(SuccessResponseSchema(ProductDetailSchema)),
    },
    409: { description: "Duplicate SKU (DUPLICATE_SKU)" },
  },
  handler: h.createProduct,
});

// ─── Product images (registered before /{id} to avoid param capture) ──────────

const listProductImagesRoute = defineRoute({
  method: "get",
  path: "/{id}/images",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "List product images",
  description: "Returns all images for a product ordered by position.",
  operationId: "listProductImages",
  params: idParams,
  responses: {
    200: {
      description: "List of product images ordered by position",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.array(ProductImageSchema),
        })
      ),
    },
  },
  handler: ih.listProductImages,
});

const attachProductImageRoute = defineRoute({
  method: "post",
  path: "/{id}/images",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Save product image",
  description:
    "Attaches an uploaded image to a product by its Media Key. Upload it first: POST /api/media/uploads, send the file as the ticket says, then POST /api/media/uploads/{id}/complete.",
  operationId: "attachProductImage",
  params: idParams,
  body: z.object({
    mediaKey: MediaKeySchema,
    altText: z.string().nullable().optional().openapi({
      description: "Alt text for accessibility",
    }),
    position: z.number().int().min(1).optional().openapi({
      description: "Display order (auto-appended at end if not provided)",
    }),
  }),
  responses: {
    201: {
      description: "Image record created",
      content: jsonContent(SuccessResponseSchema(ProductImageSchema)),
    },
    404: { description: "No product with this ID (PRODUCT_NOT_FOUND)" },
    409: { description: "The key's upload is not complete (MEDIA_NOT_READY)" },
  },
  handler: ih.attachProductImage,
});

const reorderProductImagesRoute = defineRoute({
  method: "patch",
  path: "/{id}/images/reorder",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Reorder product images",
  description:
    "Sets the display order of a product's images. Send the complete ordered array of image IDs — every existing image ID must be included exactly once. The server assigns position 1, 2, 3… based on the array order. Returns the full reordered image list.",
  operationId: "reorderProductImages",
  params: idParams,
  body: z.object({
    imageIds: z.array(z.string()).min(1).openapi({
      description:
        "Complete ordered list of all image IDs for this product. All existing image IDs must be included — no duplicates, no omissions.",
      example: ["uuid-b", "uuid-a", "uuid-c"],
    }),
  }),
  responses: {
    200: {
      description: "Images reordered successfully. Returns updated image list in new order.",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.array(ProductImageSchema),
        })
      ),
    },
    422: { description: "Duplicate IDs, image IDs that don't belong to this product, or incomplete set" },
  },
  handler: ih.reorderProductImages,
});

const removeProductImageRoute = defineRoute({
  method: "delete",
  path: "/{id}/images/{imageId}",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Delete product image",
  description: "Removes the image from the product; its file is deleted once nothing else shows it. Variants that showed the image are left without one.",
  operationId: "deleteProductImage",
  params: imageIdParams,
  responses: {
    200: {
      description: "Image deleted",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })),
    },
  },
  handler: ih.removeProductImage,
});

// ─── PATCH /{id}/status (registered before /{id} to avoid param capture) ──────

const updateProductStatusRoute = defineRoute({
  method: "patch",
  path: "/{id}/status",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Update product status",
  description: "Dedicated endpoint for status-only updates. Setting `ACTIVE` auto-sets `publishedAt`.",
  operationId: "updateProductStatus",
  params: idParams,
  body: updateStatusSchema,
  responses: {
    200: {
      description: "Status updated. Returns full updated product record.",
      content: jsonContent(SuccessResponseSchema(ProductSchema)),
    },
  },
  handler: h.updateProductStatus,
});

// ─── /{id} param routes ────────────────────────────────────────────────────────

const getProductRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "Get product",
  description: "Returns full product detail including `category`, `variants`, and `images`.",
  operationId: "getProduct",
  params: idParams,
  responses: {
    200: {
      description: "Product detail",
      content: jsonContent(SuccessResponseSchema(ProductDetailSchema)),
    },
  },
  handler: h.getProduct,
});

const updateProductRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Update product",
  description:
    "Partial update — only include fields you want to change. Setting `status` to `ACTIVE` auto-sets `publishedAt`. Send `variantOptions: null` to clear all variant options when converting a variant product to simple.",
  operationId: "updateProduct",
  params: idParams,
  body: updateProductSchema,
  responses: {
    200: {
      description: "Product updated. Returns full updated product record.",
      content: jsonContent(SuccessResponseSchema(ProductDetailSchema)),
    },
  },
  handler: h.updateProduct,
});

const deleteProductRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Delete product",
  description:
    "Removes the product for good — even one that orders hold — and frees its handle and SKU. Its variants, images, reviews, stock history, offers and landing pages go with it, and its image files once nothing else shows them. Order lines that sold it keep what was sold (name, variant label, SKU, price) and lose only the link; orders a landing page of it brought lose only that attribution. `GET /products/{id}/removal` says all of it beforehand.",
  operationId: "deleteProduct",
  params: idParams,
  responses: {
    200: {
      description: "Product deleted",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          message: z.string().openapi({ example: "Product deleted" }),
        })
      ),
    },
  },
  handler: h.deleteProduct,
});

const productRemovalRoute = defineRoute({
  method: "get",
  path: "/{id}/removal",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "What removing a product does",
  description: "What `DELETE /products/{id}` would take with it and what stays — read before asking the merchant to confirm.",
  operationId: "getProductRemoval",
  params: idParams,
  responses: {
    200: { description: "The product's removal", content: jsonContent(SuccessResponseSchema(ProductRemovalSchema)) },
  },
  handler: h.getProductRemoval,
});

// ─── Variants (nested under product) ──────────────────────────────────────────

const listVariantsRoute = defineRoute({
  method: "get",
  path: "/{productId}/variants",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "List product variants",
  description: "Returns variants ordered by position, with parsed `variations` objects.",
  operationId: "listVariants",
  params: productIdParams,
  responses: {
    200: {
      description: "List of variants ordered by position",
      content: jsonContent(ListResponseSchema(ProductVariantSchema)),
    },
  },
  handler: vh.listVariants,
});

const createVariantRoute = defineRoute({
  method: "post",
  path: "/{productId}/variants",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Create product variant",
  operationId: "createVariant",
  params: productIdParams,
  body: createVariantSchema,
  responses: {
    201: {
      description: "Variant created",
      content: jsonContent(SuccessResponseSchema(ProductVariantSchema)),
    },
  },
  handler: vh.createVariant,
});

const getVariantRoute = defineRoute({
  method: "get",
  path: "/{productId}/variants/{variantId}",
  auth: { scope: SCOPES.PRODUCTS_READ },
  tags: ["Products"],
  summary: "Get product variant",
  operationId: "getVariant",
  params: variantIdParams,
  responses: {
    200: {
      description: "Variant detail",
      content: jsonContent(SuccessResponseSchema(ProductVariantSchema)),
    },
  },
  handler: vh.getVariant,
});

const updateVariantRoute = defineRoute({
  method: "patch",
  path: "/{productId}/variants/{variantId}",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Update product variant",
  description: "Partial update — only include fields you want to change.",
  operationId: "updateVariant",
  params: variantIdParams,
  body: updateVariantSchema,
  responses: {
    200: {
      description: "Variant updated",
      content: jsonContent(SuccessResponseSchema(ProductVariantSchema)),
    },
  },
  handler: vh.updateVariant,
});

const deleteVariantRoute = defineRoute({
  method: "delete",
  path: "/{productId}/variants/{variantId}",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Products"],
  summary: "Delete product variant",
  description:
    "Permanently deletes the variant. Any order line items referencing this variant will have their `variantId` set to null — order history is fully preserved.",
  operationId: "deleteVariant",
  params: variantIdParams,
  responses: {
    200: {
      description: "Variant deleted",
      content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })),
    },
    422: { description: "Cannot delete variant referenced by existing orders (VARIANT_HAS_ORDERS)" },
  },
  handler: vh.deleteVariant,
});

// ─── Router ────────────────────────────────────────────────────────────────────
// Registration order: specific paths before param-based /{id} paths

const router = new OpenAPIHono<AppContext>();

router.openapi(listProductsRoute.route, listProductsRoute.handler);
router.openapi(createProductRoute.route, createProductRoute.handler);

// /{id}/images and /{id}/status must come before /{id}
router.openapi(listProductImagesRoute.route, listProductImagesRoute.handler);
router.openapi(attachProductImageRoute.route, attachProductImageRoute.handler);
router.openapi(reorderProductImagesRoute.route, reorderProductImagesRoute.handler);
router.openapi(removeProductImageRoute.route, removeProductImageRoute.handler);
router.openapi(updateProductStatusRoute.route, updateProductStatusRoute.handler);

router.openapi(getProductRoute.route, getProductRoute.handler);
router.openapi(updateProductRoute.route, updateProductRoute.handler);
router.openapi(deleteProductRoute.route, deleteProductRoute.handler);
router.openapi(productRemovalRoute.route, productRemovalRoute.handler);

router.openapi(listVariantsRoute.route, listVariantsRoute.handler);
router.openapi(createVariantRoute.route, createVariantRoute.handler);
router.openapi(getVariantRoute.route, getVariantRoute.handler);
router.openapi(updateVariantRoute.route, updateVariantRoute.handler);
router.openapi(deleteVariantRoute.route, deleteVariantRoute.handler);

// Translations of this resource (ADR 0005) — guarded by the resource's own scopes.
registerTranslationRoutes(router, {
  resource: "product",
  path: "/{id}/translations",
  read: { scope: SCOPES.PRODUCTS_READ },
  write: { scope: SCOPES.PRODUCTS_UPDATE },
  label: "Product",
  tag: "Products",
  load: (db, id) => db.select().from(products).where(eq(products.id, id ?? "")).get(),
});

export default router;
