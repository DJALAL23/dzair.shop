/**
 * The Sendili App: the store sends its own emails through the merchant's
 * Sendili account (an Email Sender). Its key never leaves the server.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { ExternalApiError, ValidationError } from "@/lib/errors/classes";
import { maskApiKey } from "@/lib/mask";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { createSendiliClient, SendiliError, SENDILI_ERRORS } from "../../../../cod-shared/lib/sendili";
import { getEmailConfigRaw, upsertEmailConfig } from "../../../../cod-shared/queries/email-config";
import { bodyOf, jsonContent, storeOf } from "./shared";

export const sendiliSetupSchema = z.object({
  apiKey: z.string().default("").openapi({
    description: "Sendili API key. Empty string keeps the stored key (it is never sent back).",
  }),
  fromEmail: z.string().email().openapi({
    description: "Sender address — its domain must be verified in the Sendili workspace.",
    example: "noreply@acme.com",
  }),
  fromName: z.string().max(200).nullable().optional().openapi({ description: "Optional sender display name (e.g. the store name).", example: "Acme Store" }),
  enabled: z.boolean().optional(),
});

export const sendiliTestSchema = z.object({
  apiKey: z.string().optional().openapi({ description: "Test this key instead of the stored one (before saving it)." }),
});

const SetupSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      fromEmail: z.string().email().openapi({ example: "noreply@acme.com" }),
      fromName: z.string().nullable().openapi({ example: "Acme Store" }),
      enabled: z.boolean(),
      apiKeyMasked: z.string().openapi({ example: "••••a9f2" }),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
});

function view(row: { fromEmail: string; fromName: string | null; enabled: boolean; createdAt: string; updatedAt: string }, apiKey: string) {
  return { fromEmail: row.fromEmail, fromName: row.fromName, enabled: row.enabled, apiKeyMasked: maskApiKey(apiKey), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function getSendili(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const row = await getEmailConfigRaw(db, store.id);
  return c.json({ success: true, data: row ? view(row, row.apiKey) : null }, 200);
}

async function saveSendili(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const { apiKey: submitted, fromEmail, fromName, enabled } = bodyOf<typeof sendiliSetupSchema>(c);
  const apiKey = submitted.trim() || (await getEmailConfigRaw(db, store.id))?.apiKey || "";
  if (!apiKey) throw new ValidationError("A Sendili API key is required to set up Sendili", ERROR_CODES.REQUIRED_FIELD_MISSING);
  const saved = await upsertEmailConfig(db, store.id, { apiKey, fromEmail, fromName, enabled });
  return c.json({ success: true, data: view(saved, apiKey) }, 200);
}

/**
 * Checks the stored (or submitted) key against Sendili's account and answers
 * the verified sending domains, for the from-address picker. What Sendili
 * refuses is a 200 with `ok: false`: the check itself worked.
 */
async function testSendili(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const apiKey = (bodyOf<typeof sendiliTestSchema>(c)?.apiKey ?? "").trim() || (await getEmailConfigRaw(db, store.id))?.apiKey;
  if (!apiKey) throw new ValidationError("Save a Sendili API key first", ERROR_CODES.REQUIRED_FIELD_MISSING);

  try {
    const account = await createSendiliClient(apiKey).getAccount();
    return c.json({ success: true, data: { ok: true, domains: account.domains, account: account.raw } }, 200);
  } catch (err) {
    if (!(err instanceof SendiliError)) throw new ExternalApiError("sendili", err instanceof Error ? err.message : "Connection check failed");
    if (err.code === SENDILI_ERRORS.UNAUTHORIZED) {
      return c.json({ success: true, data: { ok: false, reason: "invalid_key", message: "The API key was rejected by Sendili" } }, 200);
    }
    return c.json({ success: true, data: { ok: false, reason: err.code, message: err.message, ...(err.isOutOfCredits ? { outOfCredits: true } : {}) } }, 200);
  }
}

const getRoute = defineRoute({
  method: "get",
  path: "/sendili",
  auth: { scope: SCOPES.SENDILI_READ },
  tags: ["Apps"],
  summary: "Get the Sendili App",
  description: "The store's Sendili setup, or `null` when it is not set up (the store sends no email). The API key is never returned — only a masked hint.",
  operationId: "getSendiliApp",
  responses: { 200: { description: "The Sendili App's setup (null when not set up)", content: jsonContent(SetupSchema) } },
  handler: getSendili,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/sendili",
  auth: { scope: SCOPES.SENDILI_MANAGE },
  tags: ["Apps"],
  summary: "Set up the Sendili App",
  description: "Sets up Sendili, or changes its setup. An empty `apiKey` keeps the stored key; with no key stored or sent, it is refused.",
  operationId: "saveSendiliApp",
  body: sendiliSetupSchema,
  responses: {
    200: { description: "The Sendili App's setup", content: jsonContent(SetupSchema) },
    400: { description: "No API key stored or sent (REQUIRED_FIELD_MISSING), or not an email address" },
  },
  handler: saveSendili,
});

const testRoute = defineRoute({
  method: "post",
  path: "/sendili/test",
  auth: { scope: SCOPES.SENDILI_MANAGE },
  tags: ["Apps"],
  summary: "Test the Sendili key",
  description:
    "Checks the stored (or sent) Sendili API key and answers the verified sending domains for the from-address picker. A refusal is a 200 with `ok: false` — the check itself worked.",
  operationId: "testSendiliApp",
  body: sendiliTestSchema,
  responses: {
    200: {
      description: "What Sendili answered",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            ok: z.boolean(),
            reason: z.string().optional(),
            message: z.string().optional(),
            domains: z.array(z.string()).optional().openapi({ description: "Verified sending domains — for the from-address picker.", example: ["acme.com"] }),
            account: z.record(z.string(), z.unknown()).optional().openapi({ description: "The account (usage, plan) as Sendili returns it." }),
            outOfCredits: z.boolean().optional(),
          }),
        }),
      ),
    },
    400: { description: "No API key stored or sent (REQUIRED_FIELD_MISSING)" },
    502: { description: "Sendili unreachable (EXTERNAL_API_FAILURE)" },
  },
  handler: testSendili,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);
router.openapi(testRoute.route, testRoute.handler);

export default router;
