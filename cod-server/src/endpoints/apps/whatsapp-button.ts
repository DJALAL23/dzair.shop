/**
 * The WhatsApp button App: the storefront's contact handoff — the number, what
 * the chat panel shows, and which pages the button appears on (a Storefront
 * Add-on). The storefront reads it as `whatsapp` in `/store/config`.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { ValidationError } from "@/lib/errors/classes";
import { MediaKeySchema, StoreWhatsAppWidgetSchema } from "@/openapi/schemas";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { saveWhatsAppWidgetConfig } from "../../../../cod-shared/queries/whatsapp-widget";
import {
  WIDGET_ACCENTS,
  WIDGET_LIMITS,
  WIDGET_POSITIONS,
  WIDGET_PREFILL_TOKENS,
  WIDGET_SURFACE_KEYS,
  WIDGET_SURFACES,
  WIDGET_TEXT_FIELDS,
  WIDGET_TRANSLATED_FIELDS,
  parseWhatsAppWidgetConfig,
  resolveStorefrontWidget,
  serializeWhatsAppWidgetConfig,
  type WhatsAppWidgetConfig,
} from "../../../../cod-shared/whatsapp-widget/config";
import { validateWhatsAppWidgetInput } from "../../../../cod-shared/whatsapp-widget/validate";
import { mediaUrl, type MediaDelivery } from "../../../../cod-shared/media/delivery";
import { mediaDeliveryOf, mediaOf, releaseShown } from "@/lib/media";
import { jsonContent, storeOf } from "./shared";
import { registerTranslationRoutes } from "../translations/routes";
import { getStore } from "../../../../cod-shared/queries/stores";

/**
 * The server's own rules, travelling with the config so the dashboard renders
 * its editor from them rather than keeping a second copy. A cap changed here
 * changes the UI on the next load, with no client deploy.
 */
const CAPABILITIES = {
  textFields: WIDGET_TEXT_FIELDS,
  surfaces: WIDGET_SURFACES,
  surfaceOrder: WIDGET_SURFACE_KEYS,
  accents: WIDGET_ACCENTS,
  positions: WIDGET_POSITIONS,
  prefillTokens: WIDGET_PREFILL_TOKENS,
  limits: WIDGET_LIMITS,
} as const;

/**
 * The config, plus what the storefront would actually render from it.
 *
 * `preview` is the same projection `/store/config` serves, so the dashboard's
 * preview cannot drift from the shop window: if the widget will not render,
 * the merchant sees null here and the screen says why. It is not a second
 * opinion — it is the same function.
 */
function payload(config: WhatsAppWidgetConfig, delivery: MediaDelivery) {
  return {
    config,
    avatarUrl: config.avatarKey ? mediaUrl(config.avatarKey, delivery) : null,
    preview: resolveStorefrontWidget(serializeWhatsAppWidgetConfig(config), delivery, { primary: true }),
    capabilities: CAPABILITIES,
  };
}

async function getWhatsAppButton(c: Context<AppContext>) {
  const { store } = await storeOf(c);
  return c.json({ success: true, data: payload(parseWhatsAppWidgetConfig(store.whatsappWidgetJson), mediaDeliveryOf(c.env)) }, 200);
}

async function saveWhatsAppButton(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  // The route body is deliberately loose: the button's own validator is the
  // one definition of what is acceptable, and reports every problem at once.
  const result = validateWhatsAppWidgetInput((c.req as any).valid("json"));
  if (!result.ok) {
    throw new ValidationError(result.issues[0].message, ERROR_CODES.VALIDATION_FAILED, { issues: result.issues });
  }
  const { avatarKey } = result.config;
  if (avatarKey) await mediaOf(c.env).ready(avatarKey);
  const before = parseWhatsAppWidgetConfig(store.whatsappWidgetJson).avatarKey;
  const config = await saveWhatsAppWidgetConfig(db, store.id, result.config);
  if (before && before !== avatarKey) await releaseShown(c.env, [before], "WhatsApp button avatar");
  return c.json({ success: true, data: payload(config, mediaDeliveryOf(c.env)) }, 200);
}

const SurfacesSchema = z
  .object({
    home: z.boolean(),
    catalog: z.boolean(),
    product: z.boolean(),
    pages: z.boolean(),
    thankYou: z.boolean(),
    checkout: z.boolean(),
    landing: z.boolean(),
  })
  .openapi("WhatsAppButtonSurfaces", {
    description:
      "Which kinds of storefront page the launcher appears on. A fixed registry rather " +
      "than URL patterns, and every surface off is a valid paused state.",
  });

const ConfigSchema = z
  .object({
    enabled: z.boolean(),
    phone: z.string().nullable().openapi({
      description: "Stored in E.164, however the merchant typed it.",
      example: "+213551234567",
    }),
    agentName: z.string().nullable(),
    caption: z.string().nullable(),
    avatarKey: MediaKeySchema.nullable().openapi({ description: "The agent's photo, from a completed upload; null shows the store's logo." }),
    welcomeMessage: z.string().nullable(),
    launcherLabel: z.string().nullable(),
    ctaLabel: z.string().nullable(),
    prefillGeneral: z.string().nullable(),
    prefillProduct: z.string().nullable(),
    thankYouButtonLabel: z.string().nullable(),
    prefillThankYou: z.string().nullable(),
    accent: z.enum(["whatsapp", "primary"]),
    position: z.enum(["right", "left"]),
    attention: z.boolean(),
    surfaces: SurfacesSchema,
  })
  .openapi("WhatsAppButtonConfig");

/**
 * The request body is documented, not re-validated.
 *
 * A zod copy of the rules here would run BEFORE the handler and reject with a
 * generic message, hiding the coded, explainable issues the widget validator
 * produces (`PHONE_REQUIRED` is the clearest example: the merchant needs to be
 * told the widget cannot be switched on without a number, not that a field
 * failed a refinement). It would also be a second definition of the rules —
 * so the shape is described here by example and prose, and
 * `cod-shared/whatsapp-widget/validate.ts` remains the only thing that decides
 * what is acceptable.
 */
const ConfigInputSchema = z
  .record(z.string(), z.unknown())
  .openapi("WhatsAppButtonConfigInput", {
    description:
      "The button's setup. Same shape as WhatsAppButtonConfig, with every key optional — " +
      "an omitted key takes its default. `phone` is accepted in any form the merchant " +
      "knows (0551234567, 00213…, +213…, spaced) and stored normalised. Unknown keys, an " +
      "unreachable number, an avatar that is not an uploaded image's Media Key and every text cap are refused, with each " +
      "problem listed in `context.issues`.",
    example: {
      enabled: true,
      phone: "0551234567",
      agentName: "أمين",
      caption: "نرد خلال دقائق",
      welcomeMessage: "مرحبا 👋 كيفاش نعاونك؟",
      prefillProduct: "سلام، بغيت نسقسي على {product} — {url}",
      accent: "whatsapp",
      position: "right",
      surfaces: { home: true, catalog: true, product: true, pages: true, thankYou: true, checkout: false, landing: false },
    },
  });

const ResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  data: z.object({
    config: ConfigSchema,
    avatarUrl: z.string().url().nullable().openapi({ description: "Where browsers fetch the avatar, from the store's Media Delivery" }),
    preview: StoreWhatsAppWidgetSchema.nullable().openapi({
      description:
        "Exactly what `/store/config` would hand the storefront for this configuration, " +
        "or null when nothing would render. The same function produces both, so the " +
        "dashboard's preview cannot drift from the shop window.",
    }),
    capabilities: z
      .object({
        textFields: z.record(z.string(), z.object({ max: z.number().int() })),
        surfaces: z.record(z.string(), z.object({ default: z.boolean() })),
        surfaceOrder: z.array(z.string()),
        accents: z.array(z.string()),
        positions: z.array(z.string()),
        prefillTokens: z.array(z.string()),
        limits: z.record(z.string(), z.number()),
      })
      .openapi({
        description:
          "The server's own rules — the text caps, the surface registry and its display " +
          "order, the allowed accents and sides, and the prefill tokens. The dashboard " +
          "renders its editor from these rather than keeping a second copy of them.",
      }),
  }),
});

const getRoute = defineRoute({
  method: "get",
  path: "/whatsapp-button",
  auth: { scope: SCOPES.WHATSAPP_BUTTON_READ },
  tags: ["Apps"],
  summary: "Get the WhatsApp button App",
  description:
    "The storefront's WhatsApp button. A store that never set it up gets the defaults, which are 'no button' — nothing renders until a number is saved and the button is switched on.",
  operationId: "getWhatsAppButtonApp",
  responses: {
    200: { description: "Its setup", content: jsonContent(ResponseSchema) },
  },
  handler: getWhatsAppButton,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/whatsapp-button",
  auth: { scope: SCOPES.WHATSAPP_BUTTON_MANAGE },
  tags: ["Apps"],
  summary: "Set up the WhatsApp button App",
  description: `Replaces the whole configuration — a key you omit takes its default rather than keeping the stored value, so what the screen shows is what the store gets.

**The number is normalised here, once.** Send it however the merchant typed it; it is stored in E.164 and every reader downstream sees the same string.

**Switching the button on without a number is refused** (\`PHONE_REQUIRED\`): it would leave the merchant looking at an "on" switch and a storefront with no button.

**Unknown keys are refused** rather than ignored, so a typo cannot silently vanish. Every problem is reported at once in \`context.issues\`.

Saving the defaults clears the stored configuration entirely, as removing the App does.

Turning every surface off is accepted — it is a deliberate "paused" state and keeps the merchant's text.`,
  operationId: "saveWhatsAppButtonApp",
  body: ConfigInputSchema,
  responses: {
    200: { description: "Its setup", content: jsonContent(ResponseSchema) },
    400: { description: "The setup was refused — see `context.issues`" },
  },
  handler: saveWhatsAppButton,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);

// The button's texts in the store's other languages (ADR 0005): a page in a
// language with no translation shows the theme's words in that language.
registerTranslationRoutes(router, {
  resource: "whatsappWidget",
  path: "/whatsapp-button/translations",
  read: { scope: SCOPES.WHATSAPP_BUTTON_READ },
  write: { scope: SCOPES.WHATSAPP_BUTTON_MANAGE },
  label: "WhatsApp button",
  tag: "Apps",
  load: async (db) => {
    const store = await getStore(db);
    if (!store) return null;
    const config = parseWhatsAppWidgetConfig(store.whatsappWidgetJson);
    return { id: store.id, ...Object.fromEntries(WIDGET_TRANSLATED_FIELDS.map((key) => [key, config[key]])) };
  },
});

export default router;
