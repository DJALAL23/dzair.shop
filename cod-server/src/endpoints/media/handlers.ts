import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { NotFoundError } from "@/lib/errors/classes";
import { mediaOf } from "@/lib/media";
import type { UploadReportSchema, UploadRequestSchema } from "@/openapi/schemas";
import { MEDIA_CACHE_CONTROL } from "../../../../cod-shared/media/keys";

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

/** POST /api/media/uploads — an Upload Ticket for one image. */
export async function requestUpload(c: Context<AppContext>) {
  const ticket = await mediaOf(c.env).requestUpload(body<z.infer<typeof UploadRequestSchema>>(c));
  return c.json({ success: true, data: ticket }, 201);
}

/** PUT /api/media/uploads/:id/content — a relayed upload's bytes. */
export async function receiveUpload(c: Context<AppContext>) {
  await mediaOf(c.env).receive(c.req.param("id")!, c.req.raw.body);
  return c.body(null, 204);
}

/** POST /api/media/uploads/:id/complete — the upload, confirmed with the host. */
export async function completeUpload(c: Context<AppContext>) {
  const image = await mediaOf(c.env).completeUpload(c.req.param("id")!, body<z.infer<typeof UploadReportSchema>>(c));
  return c.json({ success: true, data: image }, 200);
}

/** GET /media/:key — a file the store's server serves itself (`direct` delivery); 404 on any other host. */
export async function serveMedia(c: Context<AppContext>) {
  const key = c.req.param("key")!;
  const object = await mediaOf(c.env).open(key);
  if (object === null) throw new NotFoundError("Media", key);
  return new Response(object.body, {
    headers: { "Content-Type": object.contentType, "Content-Length": String(object.bytes), ETag: object.etag, "Cache-Control": MEDIA_CACHE_CONTROL },
  });
}
