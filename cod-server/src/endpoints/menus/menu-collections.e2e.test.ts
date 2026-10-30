/**
 * A menu item can link to a collection (migration 0050), and a collection has
 * a page of its own (`/collections/:handle`) — real D1, real migrations, real
 * routes.
 *
 *  1. Rebuilding store_menu_items to widen its destination CHECK keeps every
 *     item, its id and its translations, and the cascades still hold.
 *  2. A collection item resolves to the collection's path, follows a renamed
 *     handle, and goes when the collection does.
 *  3. A storefront reads a collection's title and description in a language.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { signIn } from "@/test-utils/sign-in";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";
import collectionsRouter from "../collections/routes";
import menusRouter from "./routes";
import { TEST_MEDIA_VARS } from "@/test-utils/media";

const T = "2026-10-01T00:00:00.000Z";
const STORE = "s1";

describe("migration 0050", () => {
  let legacy: TestD1;
  const run = (query: string) => legacy.raw.prepare(query).run();

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0050_menu_items_link_collections.sql" });
    await run(`INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('${STORE}', 'B', 'fr', '${T}', '${T}')`);
    await run(`INSERT INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES ('m1', '${STORE}', 'main-menu', 'Menu', '${T}', '${T}')`);
    await run(`INSERT INTO store_menu_items (id, menu_id, parent_id, position, label, destination_type, created_at, updated_at) VALUES ('a', 'm1', NULL, 0, 'Accueil', 'home', '${T}', '${T}')`);
    await run(`INSERT INTO store_menu_items (id, menu_id, parent_id, position, label, destination_type, created_at, updated_at) VALUES ('b', 'm1', 'a', 1, 'Boutique', 'catalog', '${T}', '${T}')`);
    await run(`INSERT INTO store_menu_items (id, menu_id, parent_id, position, label, destination_type, url, created_at, updated_at) VALUES ('c', 'm1', NULL, 2, 'Insta', 'url', 'https://instagram.com/b', '${T}', '${T}')`);
    await run(`INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('menuItem', 'b', 'ar', 'label', 'المتجر', 'd', '${T}')`);
    await expect(run(`INSERT INTO store_menu_items (id, menu_id, position, label, destination_type, destination_ref, created_at, updated_at) VALUES ('x', 'm1', 3, 'X', 'collection', 'c1', '${T}', '${T}')`)).rejects.toThrow();
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  it("keeps every item, its place and its translation", async () => {
    const rows = await legacy.raw.prepare("SELECT id, parent_id, position, destination_type, url FROM store_menu_items ORDER BY position").all();
    expect(rows.results).toEqual([
      { id: "a", parent_id: null, position: 0, destination_type: "home", url: null },
      { id: "b", parent_id: "a", position: 1, destination_type: "catalog", url: null },
      { id: "c", parent_id: null, position: 2, destination_type: "url", url: "https://instagram.com/b" },
    ]);
    expect(await legacy.raw.prepare("SELECT value FROM translations WHERE resource_id = 'b'").first()).toEqual({ value: "المتجر" });
  });

  it("takes a collection now, and still refuses an incomplete one", async () => {
    await run(`INSERT INTO store_menu_items (id, menu_id, position, label, destination_type, destination_ref, created_at, updated_at) VALUES ('d', 'm1', 3, 'Robes', 'collection', 'c1', '${T}', '${T}')`);
    await expect(run(`INSERT INTO store_menu_items (id, menu_id, position, label, destination_type, created_at, updated_at) VALUES ('e', 'm1', 4, 'X', 'collection', '${T}', '${T}')`)).rejects.toThrow();
  });

  it("still deletes children and their translations with their parent, and items with their menu", async () => {
    await run("DELETE FROM store_menu_items WHERE id = 'a'");
    expect((await legacy.raw.prepare("SELECT id FROM store_menu_items ORDER BY id").all<{ id: string }>()).results.map((row) => row.id)).toEqual(["c", "d"]);
    expect(await legacy.raw.prepare("SELECT count(*) AS n FROM translations").first()).toEqual({ n: 0 });
    await run("DELETE FROM store_menus WHERE id = 'm1'");
    expect(await legacy.raw.prepare("SELECT count(*) AS n FROM store_menu_items").first()).toEqual({ n: 0 });
  });
});

describe("menus that link to collections", () => {
  let d1: TestD1;
  let app: OpenAPIHono<AppContext>;

  beforeAll(async () => {
    d1 = await createTestD1();
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: d1.raw, ...TEST_MEDIA_VARS } as AppContext["Bindings"];
      c.set("storeId", STORE);
      signIn(c, { id: "admin", name: "Admin", role: "admin", status: "active", scopes: ["*"] } as never);
      await next();
    });
    app.onError(errorHandler);
    app.route("/store", storeRoutes);
    app.route("/api/menus", menusRouter);
    app.route("/api/collections", collectionsRouter);
  }, 120_000);

  afterAll(async () => {
    await d1?.dispose();
  });

  beforeEach(async () => {
    for (const table of ["translations", "store_menu_items", "store_menus", "collection_products", "collections", "store_locales", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
    await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.storeLocales).values([
      { storeId: STORE, locale: "fr", published: true, createdAt: T },
      { storeId: STORE, locale: "ar", published: true, createdAt: T },
    ]);
    await d1.db.insert(schema.collections).values({ id: "c1", storeId: STORE, handle: "robes-ete", title: "Robes d'été", description: "Légères", createdAt: T, updatedAt: T });
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  it("resolve a collection item to its page, follow a new handle, and drop it with the collection", async () => {
    const menu = (await call("POST", "/api/menus", { handle: "main-menu", title: "Menu" })).body.data.id;
    const saved = await call("PUT", `/api/menus/${menu}/items`, { items: [{ label: "Robes", destination: { type: "collection", ref: "c1" } }] });
    expect(saved.body.data.items[0]).toMatchObject({ destination: { type: "collection", ref: "c1" }, destinationStatus: "ok", destinationLabel: "Robes d'été" });
    expect((await call("GET", "/store/menus/main-menu")).body.data.items).toEqual([{ label: "Robes", href: "/collections/robes-ete", type: "collection", children: [] }]);

    await call("PATCH", "/api/collections/c1", { handle: "robes" });
    expect((await call("GET", "/store/menus/main-menu")).body.data.items[0].href).toBe("/collections/robes");

    await call("DELETE", "/api/collections/c1");
    expect((await call("GET", "/store/menus/main-menu")).body.data.items).toEqual([]);
    expect((await call("GET", `/api/menus/${menu}`)).body.data.items[0].destinationStatus).toBe("missing");
  });

  it("find collections for the picker, by title or handle", async () => {
    const found = await call("GET", "/api/menus/destinations?type=collection&q=robe");
    expect(found.body.data).toEqual([{ id: "c1", label: "Robes d'été", path: "/collections/robes-ete", visible: true }]);
  });

  it("give a storefront the collection's title and description, in a language, and 404 for an unknown handle", async () => {
    expect((await call("GET", "/store/collections/robes-ete")).body.data).toEqual({ handle: "robes-ete", title: "Robes d'été", description: "Légères", productCount: 0, image: null });
    await d1.db.insert(schema.translations).values({ resourceType: "collection", resourceId: "c1", locale: "ar", key: "title", value: "فساتين الصيف", sourceDigest: "d", updatedAt: T });
    expect((await call("GET", "/store/collections/robes-ete?locale=ar")).body.data).toEqual({ handle: "robes-ete", title: "فساتين الصيف", description: "Légères", productCount: 0, image: null });
    expect((await call("GET", "/store/collections/nope")).status).toBe(404);
  });
});
