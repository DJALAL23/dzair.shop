/**
 * The DZVerify App: WhatsApp codes and messages, today its phone check at
 * checkout (a Checkout Check, `store-otp/`). Its key is the merchant's own
 * and never leaves the server.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { ExternalApiError, ValidationError } from "@/lib/errors/classes";
import { maskApiKey } from "@/lib/mask";
import { createDzverifyClient, DzverifyError, DZVERIFY_ERRORS } from "@/endpoints/store-otp/dzverify";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { getOtpConfigRaw, upsertOtpConfig } from "../../../../cod-shared/queries/otp-config";
import { bodyOf, jsonContent, storeOf } from "./shared";

export const dzverifySetupSchema = z.object({
  apiKey: z.string().default("").openapi({
    description: "dzverify API key. Empty string keeps the stored key (it is never sent back).",
  }),
  language: z.enum(["en", "fr", "ar"]).optional(),
  enabled: z.boolean().optional(),
});

export const dzverifyTestSchema = z.object({
  apiKey: z.string().optional().openapi({ description: "Test this key instead of the stored one (before saving it)." }),
});

const SetupSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      language: z.enum(["en", "fr", "ar"]),
      enabled: z.boolean(),
      apiKeyMasked: z.string().openapi({ example: "••••a9f2" }),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
});

function view(row: { language: "en" | "fr" | "ar"; enabled: boolean; createdAt: string; updatedAt: string }, apiKey: string) {
  return { language: row.language, enabled: row.enabled, apiKeyMasked: maskApiKey(apiKey), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function getDzverify(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const row = await getOtpConfigRaw(db, store.id);
  return c.json({ success: true, data: row ? view(row, row.apiKey) : null }, 200);
}

async function saveDzverify(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const { apiKey: submitted, language, enabled } = bodyOf<typeof dzverifySetupSchema>(c);
  const apiKey = submitted.trim() || (await getOtpConfigRaw(db, store.id))?.apiKey || "";
  if (!apiKey) throw new ValidationError("A dzverify API key is required to set up DZVerify", ERROR_CODES.REQUIRED_FIELD_MISSING);
  const saved = await upsertOtpConfig(db, store.id, { apiKey, language, enabled });
  return c.json({ success: true, data: view(saved, apiKey) }, 200);
}

/**
 * Checks the stored (or submitted) key against dzverify's quota. A working key
 * without the usage:read scope is valid with its quota unavailable. What
 * dzverify refuses is a 200 with `ok: false`: the check itself worked.
 */
async function testDzverify(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const apiKey = (bodyOf<typeof dzverifyTestSchema>(c)?.apiKey ?? "").trim() || (await getOtpConfigRaw(db, store.id))?.apiKey;
  if (!apiKey) throw new ValidationError("Save a dzverify API key first", ERROR_CODES.REQUIRED_FIELD_MISSING);

  try {
    const quota = await createDzverifyClient(apiKey).getQuota();
    return c.json({ success: true, data: { ok: true, balanceDa: quota.balanceDa, otpEstimate: quota.otpEstimate, plan: quota.plan } }, 200);
  } catch (err) {
    if (!(err instanceof DzverifyError)) throw new ExternalApiError("dzverify", err instanceof Error ? err.message : "Connection check failed");
    if (err.code === DZVERIFY_ERRORS.UNAUTHORIZED) {
      return c.json({ success: true, data: { ok: false, reason: "invalid_key", message: "The API key was rejected by dzverify" } }, 200);
    }
    if (err.code === DZVERIFY_ERRORS.FORBIDDEN) {
      return c.json({ success: true, data: { ok: true, reason: "quota_scope_missing", message: "Key is valid but lacks the usage:read scope — quota preview unavailable" } }, 200);
    }
    return c.json({ success: true, data: { ok: false, reason: err.code, message: err.message, ...(err.isOutOfCredits ? { outOfCredits: true } : {}) } }, 200);
  }
}

const getRoute = defineRoute({
  method: "get",
  path: "/dzverify",
  auth: { scope: SCOPES.DZVERIFY_READ },
  tags: ["Apps"],
  summary: "Get the DZVerify App",
  description: "The store's DZVerify setup, or `null` when it is not set up (no phone check). The API key is never returned — only a masked hint.",
  operationId: "getDzverifyApp",
  responses: { 200: { description: "The DZVerify App's setup (null when not set up)", content: jsonContent(SetupSchema) } },
  handler: getDzverify,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/dzverify",
  auth: { scope: SCOPES.DZVERIFY_MANAGE },
  tags: ["Apps"],
  summary: "Set up the DZVerify App",
  description: "Sets up DZVerify, or changes its setup. An empty `apiKey` keeps the stored key; with no key stored or sent, it is refused.",
  operationId: "saveDzverifyApp",
  body: dzverifySetupSchema,
  responses: {
    200: { description: "The DZVerify App's setup", content: jsonContent(SetupSchema) },
    400: { description: "No API key stored or sent (REQUIRED_FIELD_MISSING)" },
  },
  handler: saveDzverify,
});

const testRoute = defineRoute({
  method: "post",
  path: "/dzverify/test",
  auth: { scope: SCOPES.DZVERIFY_MANAGE },
  tags: ["Apps"],
  summary: "Test the DZVerify key",
  description:
    "Checks the stored (or sent) dzverify API key against the provider's quota. A key lacking the usage:read scope is valid with its quota unavailable. A refusal is a 200 with `ok: false` — the check itself worked.",
  operationId: "testDzverifyApp",
  body: dzverifyTestSchema,
  responses: {
    200: {
      description: "What dzverify answered",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            ok: z.boolean(),
            reason: z.string().optional(),
            message: z.string().optional(),
            balanceDa: z.number().optional(),
            otpEstimate: z.number().optional().openapi({ description: "How many more codes the balance covers" }),
            plan: z.string().optional(),
            outOfCredits: z.boolean().optional(),
          }),
        }),
      ),
    },
    400: { description: "No API key stored or sent (REQUIRED_FIELD_MISSING)" },
    502: { description: "dzverify unreachable (EXTERNAL_API_FAILURE)" },
  },
  handler: testDzverify,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);
router.openapi(testRoute.route, testRoute.handler);

export default router;
