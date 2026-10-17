/**
 * Collections — the merchant's curated product lists. A collection's products
 * are saved as one ordered list (`PUT /{id}/products`); a product also joins
 * collections from its own page (`collectionIds` on the product routes).
 * Built with defineRoute().
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { collections } from "../../../../cod-shared/db/schema";
import { SuccessResponseSchema } from "@/openapi/schemas";
import {
  CollectionDetailSchema,
  CollectionSummarySchema,
  CreateCollectionSchema,
  SaveCollectionProductsSchema,
  UpdateCollectionSchema,
} from "@/openapi/schemas/collections";
import { registerTranslationRoutes } from "../translations/routes";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const idParams = z.object({ id: z.string().openapi({ description: "Collection id" }) });
const detail = (description: string) => ({ description, content: jsonContent(SuccessResponseSchema(CollectionDetailSchema)) });

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.COLLECTIONS_READ },
  tags: ["Collections"],
  summary: "List collections",
  description: "Every collection of the store, oldest first, with how many products each holds.",
  operationId: "listCollections",
  responses: {
    200: {
      description: "The store's collections",
      content: jsonContent(z.object({ success: z.boolean(), data: z.array(CollectionSummarySchema), count: z.number().int() })),
    },
  },
  handler: h.list,
});

const getRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.COLLECTIONS_READ },
  tags: ["Collections"],
  summary: "Get a collection",
  description: "A collection with its products in order, each saying whether shoppers see it now.",
  operationId: "getCollection",
  params: idParams,
  responses: { 200: detail("The collection"), 404: { description: "No such collection" } },
  handler: h.get,
});

const createRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.COLLECTIONS_MANAGE },
  tags: ["Collections"],
  summary: "Create a collection",
  description: "An empty collection; add products with `PUT /{id}/products` or from a product's page.",
  operationId: "createCollection",
  body: CreateCollectionSchema,
  responses: { 201: detail("The new collection"), 409: { description: "Another collection has this handle" } },
  handler: h.create,
});

const updateRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.COLLECTIONS_MANAGE },
  tags: ["Collections"],
  summary: "Rename a collection",
  description: "Changes its title, description or handle. A theme names a collection by handle, so a new handle moves it out of every theme setting that named the old one.",
  operationId: "updateCollection",
  params: idParams,
  body: UpdateCollectionSchema,
  responses: { 200: detail("The collection"), 404: { description: "No such collection" }, 409: { description: "Another collection has this handle" } },
  handler: h.update,
});

const saveProductsRoute = defineRoute({
  method: "put",
  path: "/{id}/products",
  auth: { scope: SCOPES.COLLECTIONS_MANAGE },
  tags: ["Collections"],
  summary: "Save a collection's products",
  description: "Replaces the collection's products with this ordered list, at once. Every id must name a product, once.",
  operationId: "saveCollectionProducts",
  params: idParams,
  body: SaveCollectionProductsSchema,
  responses: {
    200: detail("The collection as saved"),
    400: { description: "A product listed twice, or one that does not exist" },
    404: { description: "No such collection" },
  },
  handler: h.saveProducts,
});

const deleteRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.COLLECTIONS_MANAGE },
  tags: ["Collections"],
  summary: "Delete a collection",
  description: "Deletes the collection (its products stay in the catalog). A theme section naming it then shows nothing.",
  operationId: "deleteCollection",
  params: idParams,
  responses: {
    200: { description: "Deleted", content: jsonContent(SuccessResponseSchema(z.object({ id: z.string() }))) },
    404: { description: "No such collection" },
  },
  handler: h.remove,
});

const router = new OpenAPIHono<AppContext>();

router.openapi(listRoute.route, listRoute.handler);
router.openapi(getRoute.route, getRoute.handler);
router.openapi(createRoute.route, createRoute.handler);
router.openapi(updateRoute.route, updateRoute.handler);
router.openapi(saveProductsRoute.route, saveProductsRoute.handler);
router.openapi(deleteRoute.route, deleteRoute.handler);

registerTranslationRoutes(router, {
  resource: "collection",
  path: "/{id}/translations",
  read: { scope: SCOPES.COLLECTIONS_READ },
  write: { scope: SCOPES.COLLECTIONS_MANAGE },
  label: "Collection",
  tag: "Collections",
  load: (db, id) => db.select().from(collections).where(eq(collections.id, id ?? "")).get(),
});

export default router;
