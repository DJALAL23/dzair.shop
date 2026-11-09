/**
 * The store's Apps through the merchant's API (Apps context): which it has
 * and where each stands, each App's own setup under `/api/apps/<key>`, and
 * removing one. Every App is seen and changed with its own permissions.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { MessageResponseSchema } from "@/openapi/schemas";
import { hasPermission } from "../../../../cod-shared/rbac/utils";
import { APP_CATALOG, APP_CATEGORIES, type AppKey } from "../../../../cod-shared/apps/catalog";
import { APP_STATUSES, appStatuses, removeApp } from "../../../../cod-shared/queries/apps";
import { jsonContent, storeOf } from "./shared";
import meta from "./meta";
import dzverify from "./dzverify";
import turnstile from "./turnstile";
import sendili from "./sendili";
import whatsappButton from "./whatsapp-button";
import telegram from "./telegram";
import reviews from "./reviews";
import orderProtection from "./order-protection";

/** Apps whose removal also tells an outside service, through their own route. */
const REMOVED_BY_THEIR_OWN_ROUTE: readonly AppKey[] = ["telegram"];

const AppSchema = z
  .object({
    key: z.enum(APP_CATALOG.map((app) => app.key) as [AppKey, ...AppKey[]]).openapi({ description: "The App Key: its name in URLs, the API and permissions" }),
    category: z.enum(APP_CATEGORIES),
    status: z.enum(APP_STATUSES).openapi({
      description: "not_set_up | on | off | needs_attention (on, but what it sends is failing, or it cannot do what it is on for)",
    }),
  })
  .openapi("App");

async function listApps(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const statuses = await appStatuses(db, store.id);
  const scopes = c.get("user").scopes;
  const apps = APP_CATALOG.filter((app) => hasPermission(scopes, app.permissions.read)).map((app) => ({ key: app.key, category: app.category, status: statuses[app.key] }));
  return c.json({ success: true, data: apps }, 200);
}

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { anyOf: APP_CATALOG.map((app) => app.permissions.read) },
  tags: ["Apps"],
  summary: "List the store's Apps",
  description: "Every App the caller may see, with where it stands for this store.",
  operationId: "listApps",
  responses: {
    200: { description: "The Apps, in catalog order", content: jsonContent(z.object({ success: z.boolean(), data: z.array(AppSchema) })) },
  },
  handler: listApps,
});

type RemovableApp = Extract<(typeof APP_CATALOG)[number], { removable: true }>;

const removeRoutes = APP_CATALOG.filter((app): app is RemovableApp => app.removable && !REMOVED_BY_THEIR_OWN_ROUTE.includes(app.key)).map((app) =>
  defineRoute({
    method: "delete",
    path: `/${app.key}`,
    auth: { scope: app.permissions.manage },
    tags: ["Apps"],
    summary: `Remove the ${app.key} App`,
    description: "Forgets the App's setup and every key it holds, as if it had never been set up. Its Built-in Consumers stay, with nothing to send.",
    operationId: `remove-${app.key}-app`.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()),
    responses: { 200: { description: "Removed", content: jsonContent(MessageResponseSchema) } },
    handler: async (c: Context<AppContext>) => {
      const { db, store } = await storeOf(c);
      await removeApp(db, store.id, app.key);
      return c.json({ success: true, message: "App removed" }, 200);
    },
  }),
);

const router = new OpenAPIHono<AppContext>();
router.openapi(listRoute.route, listRoute.handler);
for (const remove of removeRoutes) router.openapi(remove.route, remove.handler);
for (const app of [meta, dzverify, turnstile, sendili, whatsappButton, telegram, reviews, orderProtection]) router.route("/", app);

export default router;
