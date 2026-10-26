/**
 * The Meta App: the store's pixel on the storefront and its conversions sent
 * to Meta (Apps context). Its Built-in Consumer, Meta conversions, is seen and
 * steered through `/api/event-consumers` with this App's permissions.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SystemError } from "@/lib/errors/classes";
import { maskApiKey } from "@/lib/mask";
import { StorePixelConfigSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { getPixelConfig, upsertPixelConfig } from "../../../../cod-shared/queries/pixel-config";
import { bodyOf, jsonContent, storeOf } from "./shared";

/**
 * The Meta App's setup, as it arrives from the dashboard. The route validates
 * with this one schema: a `defineRoute` body strips unknown keys before the
 * handler runs, so a second copy would drop a field silently.
 */
export const metaSetupSchema = z.object({
  pixelId: z.string().min(1),
  adAccountName: z.string().max(200).nullable().optional(),
  accessToken: z.string().default("").openapi({
    description: "Meta access token. Empty string keeps the stored token (it is never sent back).",
  }),
  testEventCode: z.string().nullable().optional(),
  conversionEvent: z.enum(["Purchase", "Purchase_Confirmed", "Purchase_Delivered", "Lead"]),
  testMode: z.boolean().optional(),
  enabled: z.boolean().optional(),
  perPageTrackingEnabled: z.boolean().optional().openapi({
    description:
      "Master switch for per-landing-page pixels. Omitted keeps the stored value — an unrelated edit must not return every landing page to the store pixel.",
  }),
});

/** Safe projection — the access token never leaves the API, only a masked hint. */
function view(row: NonNullable<Awaited<ReturnType<typeof getPixelConfig>>>) {
  return {
    id: row.id,
    storeId: row.storeId,
    pixelId: row.pixelId,
    adAccountName: row.adAccountName,
    accessTokenMasked: maskApiKey(row.accessToken),
    testEventCode: row.testEventCode,
    conversionEvent: row.conversionEvent,
    testMode: row.testMode,
    enabled: row.enabled,
    perPageTrackingEnabled: row.perPageTrackingEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getMeta(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const config = await getPixelConfig(db, store.id);
  return c.json({ success: true, data: config ? view(config) : null }, 200);
}

async function saveMeta(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const saved = await upsertPixelConfig(db, store.id, bodyOf<typeof metaSetupSchema>(c));
  if (!saved) throw new SystemError("Failed to save the Meta App");
  return c.json({ success: true, data: view(saved) }, 200);
}

const getRoute = defineRoute({
  method: "get",
  path: "/meta",
  auth: { scope: SCOPES.META_READ },
  tags: ["Apps"],
  summary: "Get the Meta App",
  description: "The store's Meta pixel and conversions setup, or `null` when the Meta App is not set up. The access token is never returned — only a masked hint.",
  operationId: "getMetaApp",
  responses: {
    200: { description: "The Meta App's setup (null when not set up)", content: jsonContent(z.object({ success: z.boolean(), data: StorePixelConfigSchema.nullable() })) },
  },
  handler: getMeta,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/meta",
  auth: { scope: SCOPES.META_MANAGE },
  tags: ["Apps"],
  summary: "Set up the Meta App",
  description:
    "Sets up the Meta App, or changes its setup. `conversionEvent` is required — the merchant chooses whether conversions optimize for `Lead` (sent at order placement, deduplicated with the browser pixel) or a `Purchase` stage. An empty `accessToken` keeps the stored token; omitting `perPageTrackingEnabled` keeps the stored switch.",
  operationId: "saveMetaApp",
  body: metaSetupSchema,
  responses: {
    200: { description: "The Meta App's setup", content: jsonContent(SuccessResponseSchema(StorePixelConfigSchema)) },
  },
  handler: saveMeta,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);

export default router;
