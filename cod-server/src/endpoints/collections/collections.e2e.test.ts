/**
 * Collections (migration 0049) — real D1, real migrations, real routes.
 *
 *  1. The old storeFeatured flag becomes each store's `featured` collection,
 *     in place of the column.
 *  2. Every store starts with featured, best-sellers and new-arrivals;
 *     setup run again changes nothing.
 *  3. The merchant curates a collection as one ordered list, or from a
 *     product's own page; an unknown collection never leaves a half-made
 *     product.
 *  4. A storefront lists a collection in the merchant's order, only what
 *     shoppers may see; products on sale are a filter of their own; published
 *     SDKs still read storeFeatured.
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
import { defaultCollectionsSql } from "../../../../cod-shared/catalog/collections";
import storeRoutes from "../store/routes";
import productsRouter from "../products/routes";
import collectionsRouter from "./routes";
import { TEST_MEDIA_VARS } from "@/test-utils/media";

const T = "2026-10-01T00:00:00.000Z";
const STORE = "s1";

describe("migration 0049", () => {
  let legacy: TestD1;

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0049_collections.sql" });
    await legacy.db.run(sql`INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES (${STORE}, 'Boutique', 'fr', ${T}, ${T})`);
    for (const [id, featured, created] of [["old", 1, "2026-01-01"], ["new", 1, "2026-03-01"], ["plain", 0, "2026-02-01"]] as const) {
      await legacy.db.run(sql`INSERT INTO products (id, name, handle, price, store_featured, created_at, updated_at) VALUES (${id}, ${id}, ${id}, 1000, ${featured}, ${created}, ${T})`);
    }
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  it("moves the featured products into the store's featured collection, newest first, and drops the flag", async () => {
    const collection = await legacy.raw.prepare("SELECT id, handle, title FROM collections").first();
    expect(collection).toEqual({ id: "s1:collection:featured", handle: "featured", title: "En vedette" });
    const members = (await legacy.raw.prepare("SELECT product_id FROM collection_products ORDER BY position").all<{ product_id: string }>()).results.map((row) => row.product_id);
    expect(members).toEqual(["new", "old"]);
    const columns = (await legacy.raw.prepare("PRAGMA table_info(products)").all<{ name: string }>()).results.map((column) => column.name);
    expect(columns).not.toContain("store_featured");
  });
});

describe("collections through the real routes", () => {
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
    app.route("/api/products", productsRouter);
    app.route("/api/collections", collectionsRouter);
  }, 120_000);

  afterAll(async () => {
    await d1?.dispose();
  });

  beforeEach(async () => {
    for (const table of ["translations", "collection_products", "collections", "products", "store_locales", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
    await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.storeLocales).values([
      { storeId: STORE, locale: "fr", published: true, createdAt: T },
      { storeId: STORE, locale: "ar", published: true, createdAt: T },
    ]);
    const product = (id: string, created: string, extra: Partial<typeof schema.products.$inferInsert> = {}) => ({
      id, name: `Produit ${id}`, handle: id, sku: id, price: 1000, createdAt: created, updatedAt: T, ...extra,
    });
    await d1.db.insert(schema.products).values([
      product("a", "2026-01-01"),
      product("b", "2026-01-02", { compareAtPrice: 1500 }),
      product("c", "2026-01-03", { compareAtPrice: 900 }),
      product("hidden", "2026-01-04", { showInStore: false }),
      product("draft", "2026-01-05", { status: "DRAFT" }),
    ]);
    for (const statement of await defaultCollectionsSql({ id: STORE, lang: "fr" }, "2026-10-02T00:00:00.000Z")) await d1.raw.prepare(statement).run();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const collectionId = async (handle: string) => (await call("GET", "/api/collections")).body.data.find((c: { handle: string }) => c.handle === handle).id as string;
  const storefront = async (query: string) => (await call("GET", `/store/products?${query}`)).body.data.map((p: { id: string }) => p.id);

  it("start every store with featured, best sellers and new arrivals, translated; setup again changes nothing", async () => {
    const listed = (await call("GET", "/api/collections")).body.data;
    expect(listed.map((c: { handle: string; title: string; productCount: number }) => [c.handle, c.title, c.productCount])).toEqual([
      ["featured", "En vedette", 0],
      ["best-sellers", "Meilleures ventes", 0],
      ["new-arrivals", "Nouveautés", 0],
    ]);
    const translated = await call("GET", `/api/collections/${await collectionId("best-sellers")}/translations`);
    expect(translated.body.data.translations.ar.title.value).toBe("الأكثر مبيعاً");
    await call("PATCH", `/api/collections/${await collectionId("best-sellers")}`, { title: "Top ventes" });
    for (const statement of await defaultCollectionsSql({ id: STORE, lang: "fr" }, "2026-10-03T00:00:00.000Z")) await d1.raw.prepare(statement).run();
    expect((await call("GET", "/api/collections")).body.data.map((c: { title: string }) => c.title)).toEqual(["En vedette", "Top ventes", "Nouveautés"]);
  });

  it("are curated as one ordered list, refused whole when a product is unknown or twice", async () => {
    const id = await collectionId("best-sellers");
    const saved = await call("PUT", `/api/collections/${id}/products`, { productIds: ["c", "a", "hidden"] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.products.map((p: { id: string; visible: boolean }) => [p.id, p.visible])).toEqual([["c", true], ["a", true], ["hidden", false]]);
    expect(await call("PUT", `/api/collections/${id}/products`, { productIds: ["a", "ghost"] })).toMatchObject({ status: 400, body: { code: "INVALID_COLLECTION_PRODUCTS" } });
    expect((await call("PUT", `/api/collections/${id}/products`, { productIds: ["a", "a"] })).status).toBe(400);
    expect((await call("GET", `/api/collections/${id}`)).body.data.products.map((p: { id: string }) => p.id)).toEqual(["c", "a", "hidden"]);
  });

  it("refuse a handle twice, and a handle that is not one", async () => {
    expect(await call("POST", "/api/collections", { handle: "featured", title: "Autre" })).toMatchObject({ status: 409, body: { code: "DUPLICATE_COLLECTION_HANDLE" } });
    expect((await call("POST", "/api/collections", { handle: "Not A Handle", title: "x" })).status).toBe(400);
    expect((await call("POST", "/api/collections", { handle: "ramadan", title: "Ramadan" })).status).toBe(201);
  });

  it("are joined from a product's own page: at the end of each new one, keeping its place in the others", async () => {
    const best = await collectionId("best-sellers");
    const fresh = await collectionId("new-arrivals");
    await call("PUT", `/api/collections/${best}/products`, { productIds: ["b", "c"] });

    const edited = await call("PATCH", "/api/products/b", { collectionIds: [best, fresh] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.collectionIds.sort()).toEqual([best, fresh].sort());
    expect((await call("GET", `/api/collections/${best}`)).body.data.products.map((p: { id: string }) => p.id)).toEqual(["b", "c"]);

    await call("PATCH", "/api/products/a", { collectionIds: [best] });
    expect((await call("GET", `/api/collections/${best}`)).body.data.products.map((p: { id: string }) => p.id)).toEqual(["b", "c", "a"]);

    await call("PATCH", "/api/products/b", { collectionIds: [] });
    expect((await call("GET", "/api/products/b")).body.data.collectionIds).toEqual([]);
    expect((await call("GET", `/api/collections/${best}`)).body.data.products.map((p: { id: string }) => p.id)).toEqual(["c", "a"]);
  });

  it("never leave a half-made product behind an unknown collection", async () => {
    const created = await call("POST", "/api/products", { name: "Nouveau", price: 500, sku: "NEW-1", collectionIds: ["ghost"] });
    expect(created).toMatchObject({ status: 400, body: { code: "COLLECTION_NOT_FOUND" } });
    expect(await d1.db.select().from(schema.products).where(sql`sku = 'NEW-1'`).all()).toEqual([]);

    const featured = await collectionId("featured");
    const ok = await call("POST", "/api/products", { name: "Nouveau", price: 500, sku: "NEW-1", collectionIds: [featured] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.collectionIds).toEqual([featured]);
  });

  it("list on the storefront in the merchant's order, only what shoppers see, translated", async () => {
    await call("PUT", `/api/collections/${await collectionId("best-sellers")}/products`, { productIds: ["a", "hidden", "draft", "b", "c"] });
    expect(await storefront("collection=best-sellers")).toEqual(["a", "b", "c"]);
    expect(await storefront("collection=best-sellers&limit=1&offset=1")).toEqual(["b"]);
    expect(await storefront("collection=nope")).toEqual([]);
    expect(await storefront("")).toEqual(["c", "b", "a"]);
  });

  it("filter the products on sale: priced below their compare-at price", async () => {
    expect(await storefront("onSale=true")).toEqual(["b"]);
  });

  it("list a collection's products on the storefront, in the merchant's order", async () => {
    await call("PUT", `/api/collections/${await collectionId("featured")}/products`, { productIds: ["b", "a"] });
    expect(await storefront("collection=featured")).toEqual(["b", "a"]);
  });

  it("let a product go for good: it leaves its collections, the collections stay", async () => {
    const best = await collectionId("best-sellers");
    await call("PUT", `/api/collections/${best}/products`, { productIds: ["a", "c"] });
    await d1.raw.prepare("DELETE FROM products WHERE id = 'a'").run();
    expect((await call("GET", `/api/collections/${best}`)).body.data.products.map((p: { id: string }) => p.id)).toEqual(["c"]);
    expect((await call("DELETE", `/api/collections/${best}`)).status).toBe(200);
    expect(await d1.db.select().from(schema.products).where(sql`id = 'c'`).all()).toHaveLength(1);
    expect(await d1.raw.prepare("SELECT count(*) AS n FROM translations WHERE resource_id = ?").bind(best).first<{ n: number }>()).toEqual({ n: 0 });
  });
});
