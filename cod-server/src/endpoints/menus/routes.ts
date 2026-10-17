/**
 * Navigation menus — the store's menus a theme renders (header, footer, …).
 * A menu's items are saved as one tree (`PUT /{id}/items`). Built with
 * defineRoute().
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { SuccessResponseSchema } from "@/openapi/schemas";
import { CreateMenuSchema, MenuDetailSchema, MenuSummarySchema, SaveMenuItemsSchema, UpdateMenuSchema } from "@/openapi/schemas/menus";
import { eq } from "drizzle-orm";
import { storeMenuItems } from "../../../../cod-shared/db/schema";
import { registerTranslationRoutes } from "../translations/routes";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const idParams = z.object({ id: z.string().openapi({ description: "Menu id" }) });

const detail = (description: string) => ({ description, content: jsonContent(SuccessResponseSchema(MenuDetailSchema)) });

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.NAVIGATION_READ },
  tags: ["Navigation"],
  summary: "List menus",
  description: "Every menu of the store, oldest first, with how many items each holds.",
  operationId: "listMenus",
  responses: {
    200: {
      description: "The store's menus",
      content: jsonContent(z.object({ success: z.boolean(), data: z.array(MenuSummarySchema), count: z.number().int() })),
    },
  },
  handler: h.list,
});

const getRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.NAVIGATION_READ },
  tags: ["Navigation"],
  summary: "Get a menu",
  description: "A menu with its item tree. Each item says whether shoppers can follow it (`destinationStatus`).",
  operationId: "getMenu",
  params: idParams,
  responses: { 200: detail("The menu"), 404: { description: "No such menu" } },
  handler: h.get,
});

const createRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.NAVIGATION_MANAGE },
  tags: ["Navigation"],
  summary: "Create a menu",
  description: "An empty menu; add its items with `PUT /{id}/items`.",
  operationId: "createMenu",
  body: CreateMenuSchema,
  responses: { 201: detail("The new menu"), 409: { description: "Another menu has this handle" } },
  handler: h.create,
});

const updateRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.NAVIGATION_MANAGE },
  tags: ["Navigation"],
  summary: "Rename a menu",
  description: "Changes its title or handle. A theme reads a menu by handle, so a new handle moves the menu out of every theme setting that named the old one.",
  operationId: "updateMenu",
  params: idParams,
  body: UpdateMenuSchema,
  responses: { 200: detail("The menu"), 404: { description: "No such menu" }, 409: { description: "Another menu has this handle" } },
  handler: h.update,
});

const saveItemsRoute = defineRoute({
  method: "put",
  path: "/{id}/items",
  auth: { scope: SCOPES.NAVIGATION_MANAGE },
  tags: ["Navigation"],
  summary: "Save a menu's items",
  description:
    "Replaces the menu's items with this tree, at once. An item sent with its `id` keeps it and its translations; an item left out is deleted. At most three levels and 100 items.",
  operationId: "saveMenuItems",
  params: idParams,
  body: SaveMenuItemsSchema,
  responses: {
    200: detail("The menu as saved"),
    400: { description: "Too many items, or one item sent twice" },
    404: { description: "No such menu" },
  },
  handler: h.saveItems,
});

const deleteRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.NAVIGATION_MANAGE },
  tags: ["Navigation"],
  summary: "Delete a menu",
  description: "Deletes the menu with its items and their translations. A theme setting naming it then renders no menu.",
  operationId: "deleteMenu",
  params: idParams,
  responses: {
    200: { description: "Deleted", content: jsonContent(SuccessResponseSchema(z.object({ id: z.string() }))) },
    404: { description: "No such menu" },
  },
  handler: h.remove,
});

const router = new OpenAPIHono<AppContext>();

router.openapi(listRoute.route, listRoute.handler);
router.openapi(getRoute.route, getRoute.handler);
router.openapi(createRoute.route, createRoute.handler);
router.openapi(updateRoute.route, updateRoute.handler);
router.openapi(saveItemsRoute.route, saveItemsRoute.handler);
router.openapi(deleteRoute.route, deleteRoute.handler);

registerTranslationRoutes(router, {
  resource: "menuItem",
  path: "/items/{id}/translations",
  read: { scope: SCOPES.NAVIGATION_READ },
  write: { scope: SCOPES.NAVIGATION_MANAGE },
  label: "Menu item",
  tag: "Navigation",
  load: (db, id) => db.select().from(storeMenuItems).where(eq(storeMenuItems.id, id ?? "")).get(),
});

export default router;
