/**
 * Media (ADR 0021, cod-shared/media/CONTEXT.md). Two routers:
 *   - uploadsRouter → /api/media/*  (auth): a browser's upload, in three steps
 *       POST /uploads               an Upload Ticket
 *       PUT  /uploads/{id}/content  the bytes, when the ticket says `relay`
 *       POST /uploads/{id}/complete the upload confirmed with the host
 *   - serveRouter   → /media/:key{.+}  (public): files the store's server
 *     serves itself. Plain Hono: a key holds slashes, which the regex param
 *     matches and a createRoute path cannot express.
 */
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { MediaImageSchema, SuccessResponseSchema, UploadReportSchema, UploadRequestSchema, UploadTicketSchema } from "@/openapi/schemas";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const uploadParams = z.object({ id: z.string().openapi({ description: "The ticket's `mediaId`" }) });

const requestUploadRoute = defineRoute({
  method: "post",
  path: "/uploads",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Media"],
  summary: "Ticket an image upload",
  description:
    "Records a pending upload and answers how the browser sends the file (`send`). Then call POST /api/media/uploads/{id}/complete; the image's `key` is attachable once complete.",
  operationId: "requestMediaUpload",
  body: UploadRequestSchema,
  responses: {
    201: { description: "The ticket", content: jsonContent(SuccessResponseSchema(UploadTicketSchema)) },
    400: { description: "A folder, type or size not allowed (VALIDATION_FAILED / INVALID_FILE_TYPE / FILE_TOO_LARGE)" },
    503: { description: "The store's media is not configured, or its host is unavailable (MEDIA_NOT_CONFIGURED / MEDIA_HOST_UNAVAILABLE)" },
  },
  handler: h.requestUpload,
});

const receiveUploadRoute = defineRoute({
  method: "put",
  path: "/uploads/{id}/content",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Media"],
  summary: "Send a relayed upload's bytes",
  description: "For a `relay` ticket only: the file's bytes, no larger than the ticket's size, of its type. Then complete the upload.",
  operationId: "receiveMediaUpload",
  params: uploadParams,
  bodyContent: { "application/octet-stream": { schema: z.string().openapi({ type: "string", format: "binary" }) } },
  responses: {
    204: { description: "Stored; complete the upload" },
    400: { description: "Larger than the ticket, or not its type (FILE_TOO_LARGE / INVALID_FILE_TYPE)" },
    404: { description: "No such upload, or its ticket expired (MEDIA_UPLOAD_UNKNOWN)" },
  },
  handler: h.receiveUpload,
});

const completeUploadRoute = defineRoute({
  method: "post",
  path: "/uploads/{id}/complete",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Media"],
  summary: "Complete an image upload",
  description: "Confirms the file with the store's host. Completing twice answers the same image.",
  operationId: "completeMediaUpload",
  params: uploadParams,
  body: UploadReportSchema,
  responses: {
    200: { description: "The image, ready", content: jsonContent(SuccessResponseSchema(MediaImageSchema)) },
    404: { description: "No such upload (MEDIA_UPLOAD_UNKNOWN)" },
    409: { description: "The host does not hold the file yet (MEDIA_UPLOAD_MISSING)" },
    422: { description: "The host holds another file than the ticket's; it was deleted, start again (MEDIA_UPLOAD_MISMATCH)" },
  },
  handler: h.completeUpload,
});

export const uploadsRouter = new OpenAPIHono<AppContext>();
uploadsRouter.openapi(requestUploadRoute.route, requestUploadRoute.handler);
uploadsRouter.openapi(receiveUploadRoute.route, receiveUploadRoute.handler);
uploadsRouter.openapi(completeUploadRoute.route, completeUploadRoute.handler);

export const serveRouter = new Hono<AppContext>();
serveRouter.get("/:key{.+}", h.serveMedia);
