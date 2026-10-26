/**
 * The Turnstile App: Cloudflare's bot check on the storefront's order form (a
 * Checkout Check and its widget, a Storefront Add-on). The site key is public
 * by design; the secret key never leaves the server.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { ValidationError } from "@/lib/errors/classes";
import { maskApiKey } from "@/lib/mask";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { getTurnstileConfigRaw, upsertTurnstileConfig } from "../../../../cod-shared/queries/turnstile-config";
import { bodyOf, jsonContent, storeOf } from "./shared";

export const turnstileSetupSchema = z.object({
  siteKey: z.string().default("").openapi({ description: "Public Turnstile site key. Empty string keeps the stored one." }),
  secretKey: z.string().default("").openapi({
    description: "Siteverify secret key. Empty string keeps the stored one (it is never sent back).",
  }),
  enabled: z.boolean().optional(),
});

const SetupSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      siteKey: z.string().openapi({ description: "Public widget site key — rendered into storefront HTML.", example: "0x4AAAAAAAxxxxxxxxxxxx" }),
      enabled: z.boolean(),
      secretKeyMasked: z.string().openapi({ example: "••••a9f2" }),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
});

function view(row: { siteKey: string; secretKey: string; enabled: boolean; createdAt: string; updatedAt: string }) {
  return { siteKey: row.siteKey, enabled: row.enabled, secretKeyMasked: maskApiKey(row.secretKey), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function getTurnstile(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const row = await getTurnstileConfigRaw(db, store.id);
  return c.json({ success: true, data: row ? view(row) : null }, 200);
}

async function saveTurnstile(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const body = bodyOf<typeof turnstileSetupSchema>(c);
  const stored = await getTurnstileConfigRaw(db, store.id);
  const siteKey = body.siteKey.trim() || stored?.siteKey || "";
  const secretKey = body.secretKey.trim() || stored?.secretKey || "";
  if (!siteKey || !secretKey) {
    throw new ValidationError("Both the Turnstile site key and secret key are required to set up Turnstile", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }
  const saved = await upsertTurnstileConfig(db, store.id, { siteKey, secretKey, enabled: body.enabled });
  return c.json({ success: true, data: view({ ...saved, secretKey }) }, 200);
}

const getRoute = defineRoute({
  method: "get",
  path: "/turnstile",
  auth: { scope: SCOPES.TURNSTILE_READ },
  tags: ["Apps"],
  summary: "Get the Turnstile App",
  description: "The store's Turnstile setup, or `null` when it is not set up (no bot check). The secret key is never returned — only a masked hint.",
  operationId: "getTurnstileApp",
  responses: { 200: { description: "The Turnstile App's setup (null when not set up)", content: jsonContent(SetupSchema) } },
  handler: getTurnstile,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/turnstile",
  auth: { scope: SCOPES.TURNSTILE_MANAGE },
  tags: ["Apps"],
  summary: "Set up the Turnstile App",
  description: "Sets up Turnstile, or changes its setup. An empty `siteKey` or `secretKey` keeps the stored one; with either missing altogether, it is refused.",
  operationId: "saveTurnstileApp",
  body: turnstileSetupSchema,
  responses: {
    200: { description: "The Turnstile App's setup", content: jsonContent(SetupSchema) },
    400: { description: "A site or secret key missing (REQUIRED_FIELD_MISSING)" },
  },
  handler: saveTurnstile,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);

export default router;
