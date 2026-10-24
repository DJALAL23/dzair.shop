/**
 * What a storefront listing answers on real D1, through the store routes: how
 * many products the whole listing holds, the order a shopper asks for, a
 * search across the catalog's and the served language's names and the tags,
 * and a collection's size and cover photo. Every gate a listing applies
 * (active, shown in the store, visible) holds for each of them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import storeRouter from "./routes";

let d1: TestD1;
vi.mock("@/db", () => ({ getDb: () => d1.db }));

const T = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000Z`;

beforeAll(async () => {
  d1 = await createTestD1();
  const seed: [string, ...unknown[]][] = [
    ["INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Bébé', 'ar', ?1, ?1)", T(0)],
    ["INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s1', 'fr', 1, ?1)", T(0)],
    // name (ar), tags, price, created
    ["INSERT INTO products (id, name, handle, price, tags, created_at, updated_at) VALUES ('p-robe', 'فستان قطني', 'robe', 2400, '[\"coton\",\"été\"]', ?1, ?1)", T(1)],
    ["INSERT INTO products (id, name, handle, price, tags, created_at, updated_at) VALUES ('p-body', 'بودي للرضع', 'body', 1200, '[\"bébé\"]', ?1, ?1)", T(2)],
    ["INSERT INTO products (id, name, handle, price, tags, created_at, updated_at) VALUES ('p-pyjama', 'بيجامة', 'pyjama', 1800, '[\"bébé\"]', ?1, ?1)", T(3)],
    ["INSERT INTO products (id, name, handle, price, show_in_store, created_at, updated_at) VALUES ('p-hidden', 'فستان مخفي', 'hidden', 900, 0, ?1, ?1)", T(4)],
    ["INSERT INTO products (id, name, handle, price, status, created_at, updated_at) VALUES ('p-draft', 'فستان مسودة', 'draft', 900, 'DRAFT', ?1, ?1)", T(5)],
    ["INSERT INTO products (id, name, handle, price, visibility, created_at, updated_at) VALUES ('p-invisible', 'فستان', 'invisible', 900, 0, ?1, ?1)", T(6)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-robe', 'fr', 'name', 'Robe en coton', 'd', ?1)", T(0)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-body', 'fr', 'name', 'Body bébé', 'd', ?1)", T(0)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-pyjama', 'fr', 'name', 'Pyjama doux en coton', 'd', ?1)", T(0)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-hidden', 'fr', 'name', 'Robe cachée', 'd', ?1)", T(0)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-body', 'en', 'name', 'Baby bodysuit', 'd', ?1)", T(0)],
    ["INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p-robe', 'fr', 'tagline', 'Parfaite pour la plage', 'd', ?1)", T(0)],
    ["INSERT INTO product_images (id, product_id, src, position, created_at, updated_at) VALUES ('i-robe-2', 'p-robe', 'https://m.example/robe-2.webp', 2, ?1, ?1)", T(0)],
    ["INSERT INTO product_images (id, product_id, src, position, created_at, updated_at) VALUES ('i-robe-1', 'p-robe', 'https://m.example/robe-1.webp', 1, ?1, ?1)", T(0)],
    ["INSERT INTO product_images (id, product_id, src, position, created_at, updated_at) VALUES ('i-hidden', 'p-hidden', 'https://m.example/hidden.webp', 1, ?1, ?1)", T(0)],
    ["INSERT INTO collections (id, store_id, handle, title, created_at, updated_at) VALUES ('c-best', 's1', 'best-sellers', 'Best', ?1, ?1)", T(0)],
    ["INSERT INTO collections (id, store_id, handle, title, created_at, updated_at) VALUES ('c-empty', 's1', 'empty', 'Empty', ?1, ?1)", T(0)],
    // The merchant's order: a hidden product first (it has a photo, but no shopper sees it), then one without a photo, then the robe.
    ["INSERT INTO collection_products (collection_id, product_id, position, added_at) VALUES ('c-best', 'p-hidden', 0, ?1)", T(0)],
    ["INSERT INTO collection_products (collection_id, product_id, position, added_at) VALUES ('c-best', 'p-pyjama', 1, ?1)", T(0)],
    ["INSERT INTO collection_products (collection_id, product_id, position, added_at) VALUES ('c-best', 'p-robe', 2, ?1)", T(0)],
    ["INSERT INTO collection_products (collection_id, product_id, position, added_at) VALUES ('c-empty', 'p-draft', 0, ?1)", T(0)],
  ];
  for (const [sql, ...values] of seed) await d1.raw.prepare(sql).bind(...values).run();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

function app() {
  const router = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  router.use("*", async (c, next) => {
    c.env = { DB: {} } as never;
    c.set("storeId", "s1");
    await next();
  });
  router.onError(errorHandler);
  router.route("/store", storeRouter);
  return router;
}

async function get(path: string) {
  const response = await app().request(path);
  return { status: response.status, body: (await response.json()) as any };
}

const handles = (body: { data: { handle: string }[] }) => body.data.map((product) => product.handle);

describe("GET /store/products — the whole listing's size", () => {
  it("answers how many products the listing holds across its pages, behind every gate", async () => {
    const first = await get("/store/products?limit=2");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ count: 2, total: 3 });
    expect(handles(first.body)).toEqual(["pyjama", "body"]);
    const last = await get("/store/products?limit=2&offset=2");
    expect(last.body).toMatchObject({ count: 1, total: 3 });
    expect(handles(last.body)).toEqual(["robe"]);
  });

  it("counts a filtered listing as filtered", async () => {
    expect((await get("/store/products?collection=best-sellers")).body).toMatchObject({ count: 2, total: 2 });
    expect((await get("/store/products?collection=nope")).body).toMatchObject({ count: 0, total: 0 });
  });
});

describe("GET /store/products — the order a shopper asks for", () => {
  it.each([
    ["newest", ["pyjama", "body", "robe"]],
    ["price-ascending", ["body", "pyjama", "robe"]],
    ["price-descending", ["robe", "pyjama", "body"]],
  ])("sort=%s", async (sort, expected) => {
    expect(handles((await get(`/store/products?sort=${sort}`)).body)).toEqual(expected);
  });

  it("keeps a collection's own order unless asked otherwise", async () => {
    expect(handles((await get("/store/products?collection=best-sellers")).body)).toEqual(["pyjama", "robe"]);
    expect(handles((await get("/store/products?collection=best-sellers&sort=price-descending")).body)).toEqual(["robe", "pyjama"]);
  });

  it("refuses an order it does not know", async () => {
    expect((await get("/store/products?sort=popular")).status).toBe(400);
  });

  it("pages a sorted listing without repeating or skipping a product", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 3; offset++) seen.push(...handles((await get(`/store/products?sort=price-ascending&limit=1&offset=${offset}`)).body));
    expect(seen).toEqual(["body", "pyjama", "robe"]);
  });
});

describe("GET /store/search", () => {
  it("finds by the served language's names and the tags, names first, behind every gate", async () => {
    const found = await get("/store/search?q=bébé&locale=fr");
    expect(found.status).toBe(200);
    // The body's name holds the word; the pyjama only its tags, though it is newer.
    expect(handles(found.body)).toEqual(["body", "pyjama"]);
    expect(found.body).toMatchObject({ count: 2, total: 2 });
    expect(found.body.data[0].name).toBe("Body bébé");
  });

  it("finds by the catalog's own names in the primary language", async () => {
    expect(handles((await get("/store/search?q=فستان")).body)).toEqual(["robe"]);
    expect(handles((await get("/store/search?q=coton&locale=fr")).body)).toEqual(["pyjama", "robe"]);
    // In the primary language, a French name is not the product's name; nor, in French, an English one.
    expect(handles((await get("/store/search?q=pyjama")).body)).toEqual([]);
    expect(handles((await get("/store/search?q=bodysuit&locale=fr")).body)).toEqual([]);
    // Only a name is searched of what is translated.
    expect(handles((await get("/store/search?q=plage&locale=fr")).body)).toEqual([]);
  });

  it("needs every word, in any case for Latin letters", async () => {
    expect(handles((await get("/store/search?q=ROBE%20coton&locale=fr")).body)).toEqual(["robe"]);
    // One word in the name, the other in the tags.
    expect(handles((await get("/store/search?q=coton%20b%C3%A9b%C3%A9&locale=fr")).body)).toEqual(["pyjama"]);
    expect(handles((await get("/store/search?q=robe%20b%C3%A9b%C3%A9&locale=fr")).body)).toEqual([]);
  });

  it("filters, sorts and pages as a listing does", async () => {
    expect(handles((await get("/store/search?q=coton&locale=fr&sort=price-descending")).body)).toEqual(["robe", "pyjama"]);
    expect(handles((await get("/store/search?q=coton&locale=fr&collection=best-sellers&sort=price-ascending")).body)).toEqual(["pyjama", "robe"]);
    const page = await get("/store/search?q=coton&locale=fr&limit=1&offset=1");
    expect(page.body).toMatchObject({ count: 1, total: 2 });
  });

  it("treats LIKE's wildcards as nothing to find", async () => {
    for (const q of ["%", "_", "%25", "\\"]) {
      const found = await get(`/store/search?q=${encodeURIComponent(q)}`);
      expect(found.status, q).toBe(200);
      expect(found.body, q).toMatchObject({ count: 0, total: 0 });
    }
    expect(handles((await get(`/store/search?q=${encodeURIComponent("rob%")}&locale=fr`)).body)).toEqual(["robe"]);
  });

  it("refuses an empty or missing search", async () => {
    expect((await get("/store/search")).status).toBe(400);
    expect((await get("/store/search?q=%20%20")).status).toBe(400);
  });
});

describe("GET /store/collections/{handle} — its size and its photo", () => {
  it("counts what a shopper sees, and shows the first photo of the first product that has one", async () => {
    const { status, body } = await get("/store/collections/best-sellers");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ handle: "best-sellers", title: "Best", productCount: 2 });
    expect(body.data.image).toMatchObject({ id: "i-robe-1", src: "https://m.example/robe-1.webp", position: 1 });
  });

  it("answers a collection with nothing to show as empty, with no photo", async () => {
    const { body } = await get("/store/collections/empty");
    expect(body.data).toMatchObject({ productCount: 0, image: null });
  });
});
