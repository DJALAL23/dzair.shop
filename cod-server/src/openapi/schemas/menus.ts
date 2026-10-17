/**
 * Navigation menu schemas: the merchant's menus (`/api/menus`) and the menu a
 * storefront renders (`/store/menus/{handle}`).
 *
 * An item's children are spelled out level by level rather than recursively:
 * a menu has at most three levels, and the document says so.
 */

import { z } from "@hono/zod-openapi";
import { MENU_DESTINATION_TYPES, MENU_HANDLE_RE, MENU_MAX_ITEMS, MENU_RESOURCE_DESTINATIONS, isMenuUrl } from "../../../../cod-shared/navigation/menus";

export const MenuHandleSchema = z.string().regex(MENU_HANDLE_RE).openapi({
  description: "Lowercase letters, digits and hyphens; how a theme names the menu",
  example: "main-menu",
});

export const MenuDestinationSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.enum(["home", "catalog"]) }),
    z.object({
      type: z.enum(["category", "collection", "product", "page", "landing"]),
      ref: z.string().min(1).max(100).openapi({ description: "The category, collection, product, store page or landing page id" }),
    }),
    z.object({
      type: z.literal("url"),
      url: z.string().refine(isMenuUrl, "A path of the store (/…), an http(s) address, or a mailto/tel link").openapi({ example: "/pages/faq" }),
    }),
  ])
  .openapi("MenuDestination");

const label = z.string().trim().min(1).max(100).openapi({ example: "Robes" });
const itemId = z.string().min(1).max(100).optional().openapi({ description: "An existing item's id, to keep it (and its translations)" });

const MenuItemInputLevel3 = z.object({ id: itemId, label, destination: MenuDestinationSchema }).strict();
const MenuItemInputLevel2 = MenuItemInputLevel3.extend({ children: z.array(MenuItemInputLevel3).optional() });
export const MenuItemInputSchema = MenuItemInputLevel3.extend({ children: z.array(MenuItemInputLevel2).optional() }).openapi("MenuItemInput");

export const SaveMenuItemsSchema = z.object({
  items: z.array(MenuItemInputSchema).openapi({ description: `The whole tree, in order; at most three levels and ${MENU_MAX_ITEMS} items` }),
});

export const CreateMenuSchema = z.object({
  handle: MenuHandleSchema,
  title: z.string().trim().min(1).max(100).openapi({ example: "Main menu" }),
});

export const UpdateMenuSchema = CreateMenuSchema.partial();

export const MenuSummarySchema = z
  .object({
    id: z.string(),
    handle: MenuHandleSchema,
    title: z.string(),
    itemCount: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("MenuSummary");

const itemFields = {
  id: z.string(),
  label: z.string(),
  destination: MenuDestinationSchema,
  destinationStatus: z.enum(["ok", "missing", "hidden"]).openapi({
    description: "`missing`: the destination was deleted. `hidden`: it exists but shoppers cannot see it (a draft page, an inactive product). Either way the storefront leaves the item out.",
  }),
  destinationLabel: z.string().nullable().openapi({ description: "The destination's name (a product's or category's name, a page's slug)" }),
};
const noChildren = z.array(z.unknown()).max(0).openapi({ description: "Always empty: a third-level item has no children" });
const MenuItemLevel3 = z.object({ ...itemFields, children: noChildren });
const MenuItemLevel2 = z.object({ ...itemFields, children: z.array(MenuItemLevel3) });
export const MenuItemSchema = z.object({ ...itemFields, children: z.array(MenuItemLevel2) }).openapi("MenuItem");

export const MenuDetailSchema = z
  .object({
    id: z.string(),
    handle: MenuHandleSchema,
    title: z.string(),
    updatedAt: z.string(),
    items: z.array(MenuItemSchema),
  })
  .openapi("MenuDetail");

const storefrontItemFields = {
  label: z.string().openapi({ description: "In the requested language when the store translated it" }),
  href: z.string().openapi({
    description: "A path of the store without a language prefix (`/products/robe`), or the URL the merchant entered",
    example: "/category/robes",
  }),
  type: z.enum(MENU_DESTINATION_TYPES),
};
const StorefrontMenuItemLevel3 = z.object({ ...storefrontItemFields, children: noChildren });
const StorefrontMenuItemLevel2 = z.object({ ...storefrontItemFields, children: z.array(StorefrontMenuItemLevel3) });
export const StorefrontMenuItemSchema = z.object({ ...storefrontItemFields, children: z.array(StorefrontMenuItemLevel2) }).openapi("StorefrontMenuItem");

export const StorefrontMenuSchema = z
  .object({
    handle: MenuHandleSchema,
    title: z.string(),
    items: z.array(StorefrontMenuItemSchema).openapi({
      description: "Only items a shopper can follow: one whose destination is deleted or not public is left out, with its children",
    }),
  })
  .openapi("StorefrontMenu");

export const MenuDestinationQuerySchema = z.object({
  type: z.enum(MENU_RESOURCE_DESTINATIONS).openapi({ example: "product" }),
  q: z.string().max(100).optional().openapi({ description: "Part of the name or slug", example: "robe" }),
});

export const MenuDestinationOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    path: z.string().openapi({ description: "Its public path", example: "/products/robe" }),
    visible: z.boolean().openapi({ description: "False when shoppers cannot see it now: an item pointing at it is left out of the menu" }),
  })
  .openapi("MenuDestinationOption");
