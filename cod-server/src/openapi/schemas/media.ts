/**
 * Media schemas (ADR 0021): an image as every answer carries it, the Upload
 * Ticket a browser follows, and the store's Media Delivery.
 */
import { z } from "@hono/zod-openapi";
import { MEDIA_DELIVERY_KINDS } from "../../../../cod-shared/media/model";
import { IMAGE_TYPES, MEDIA_MAX_BYTES, UPLOAD_FOLDERS, isMediaKey } from "../../../../cod-shared/media/keys";

export const MediaKeySchema = z.string().min(1).max(512).refine(isMediaKey, { message: "Not a Media Key: a folder (products, landing, reviews) and the file's path in it" }).openapi({
  description: "A Media Key: the image's identity in the store's media. Never a URL.",
  example: "products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp",
});

export const MediaImageSchema = z
  .object({
    key: MediaKeySchema,
    url: z.string().url().openapi({ description: "Where browsers fetch it, from the store's Media Delivery", example: "https://ik.imagekit.io/wocart/stores/maysa/products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp" }),
    width: z.number().int().nullable().openapi({ description: "Pixels, when known", example: 1200 }),
    height: z.number().int().nullable().openapi({ description: "Pixels, when known", example: 900 }),
  })
  .openapi("MediaImage");

export const MediaDeliverySchema = z
  .object({
    kind: z.enum(MEDIA_DELIVERY_KINDS).openapi({ description: "How images are resized: `imagekit` (`?tr=`), `cloudflare` (`/cdn-cgi/image/`), or `direct` (not resized)" }),
    origin: z.string().url().openapi({ description: "A key's URL is this origin, a slash and the key", example: "https://ik.imagekit.io/wocart/stores/maysa" }),
  })
  .openapi("MediaDelivery");

export const UploadRequestSchema = z.object({
  folder: z.enum(UPLOAD_FOLDERS).openapi({ description: "`products` (gallery, categories, the logo, rich text, apps) or `landing` (landing-page stacks)", example: "products" }),
  contentType: z.enum(IMAGE_TYPES).openapi({ example: "image/webp" }),
  bytes: z.number().int().min(1).max(MEDIA_MAX_BYTES).openapi({ description: "The file's exact size", example: 245_760 }),
});

export const UploadTicketSchema = z
  .object({
    mediaId: z.string().openapi({ description: "Complete the upload with this id" }),
    key: MediaKeySchema,
    expiresAt: z.string().datetime(),
    send: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("form"), method: z.literal("POST"), url: z.string().url(), fields: z.record(z.string(), z.string()), fileField: z.string() }),
        z.object({ kind: z.literal("put"), method: z.literal("PUT"), url: z.string().url(), headers: z.record(z.string(), z.string()) }),
        z.object({ kind: z.literal("relay"), method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()) }),
      ])
      .openapi({
        description:
          "How to send the file: `form` — POST multipart `fields` plus the file as `fileField` to `url`; `put` — PUT the bytes to `url` with exactly `headers`; `relay` — PUT the bytes to this server's `url` (a path) with `headers`.",
      }),
  })
  .openapi("UploadTicket");

export const UploadReportSchema = z.object({
  hostRef: z.string().nullable().optional().openapi({ description: "For a `form` ticket: the `fileId` the host answered" }),
  width: z.number().int().min(1).nullable().optional().openapi({ description: "The image's width as the browser measured it" }),
  height: z.number().int().min(1).nullable().optional().openapi({ description: "The image's height as the browser measured it" }),
});
