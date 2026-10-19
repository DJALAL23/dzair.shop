/**
 * A store set up by `storeDefaultsSql` and `demoCatalogSql`, on a database
 * built from every migration, read through the real store routes in workerd:
 * what a shopper of a brand-new store finds, in its languages, and what a
 * checkout quotes; that running the setup again changes nothing; that a
 * store with its own catalog gets no starter; that the legal pages are the
 * ones the dashboard writes; and that the starter goes away like any data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";
import { demoCatalogSql, starterPrefix, storeDefaultsSql, type StarterStore } from "../../../cod-shared/starter";
import { STARTER_CATEGORIES, STARTER_IMAGES, STARTER_PRODUCTS } from "../../../cod-shared/starter/content";

const WORKER = `
import { OpenAPIHono } from "@hono/zod-openapi";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { getDb } from "@/db";
import { removeProduct } from "@/lib/remove-product";
import { seedStorePages } from "../../../cod-shared/queries/store-pages";
import storeRoutes from "../endpoints/store/routes";
const app = new OpenAPIHono({ defaultHook: openApiValidationHook });
app.use("/store/*", async (c, next) => { c.set("storeId", "store-1"); await next(); });
app.onError(errorHandler);
app.route("/store", storeRoutes);
app.post("/seed-pages/:store", async (c) => c.json(await seedStorePages(getDb(c.env.DB), c.req.param("store"))));
app.post("/remove-product/:id", async (c) => {
  const deleted = [];
  const bucket = { delete: async (keys) => { deleted.push(...[keys].flat()); } };
  const removed = await removeProduct(getDb(c.env.DB), bucket, c.req.param("id"));
  return c.json({ removed, deleted });
});
export default app;
`;

const NOW = "2026-10-20T08:00:00.000Z";
const LATER = "2026-11-02T10:30:00.000Z";
const MEDIA = "https://media.boutique.dz";
const STORE: StarterStore = { id: "store-1", name: "Boutique Amel", lang: "ar" };
const P = starterPrefix(STORE.id);

async function apply(d1: TestD1, statements: readonly string[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 50) await d1.raw.batch(statements.slice(i, i + 50).map((s) => d1.raw.prepare(s)));
}

async function setUp(d1: TestD1, store: StarterStore, now: string): Promise<void> {
  await apply(d1, [...(await storeDefaultsSql(store, now)), ...(await demoCatalogSql(store, { mediaOrigin: MEDIA, now }))]);
}

async function createStore(d1: TestD1, store: StarterStore, locales = ["ar", "fr"]): Promise<void> {
  await d1.raw.prepare("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(store.id, store.name, store.lang, NOW).run();
  for (const locale of locales) {
    await d1.raw.prepare("INSERT INTO store_locales (store_id, locale, published, created_at) VALUES (?1, ?2, 1, ?3)").bind(store.id, locale, NOW).run();
  }
}

async function rows<T = Record<string, unknown>>(d1: TestD1, sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await d1.raw.prepare(sql).bind(...binds).all<T>()).results;
}

const SEEDED_TABLES = [
  "products",
  "product_categories",
  "product_variants",
  "product_images",
  "collections",
  "collection_products",
  "offers",
  "offer_price_tiers",
  "coupons",
  "store_menus",
  "store_menu_items",
  "store_pages",
  "store_page_translations",
  "shipping_profiles",
  "shipping_rules",
  "translations",
] as const;

async function snapshot(d1: TestD1): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of SEEDED_TABLES) out[table] = await rows(d1, `SELECT * FROM ${table} ORDER BY 1, 2, 3`);
  return out;
}

async function get<T = any>(d1: TestD1, path: string): Promise<T> {
  const res = await d1.fetch(`http://store.test${path}`);
  expect(res.status, path).toBe(200);
  return ((await res.json()) as { data: T }).data;
}

async function quote(d1: TestD1, body: Record<string, unknown>): Promise<any> {
  const res = await d1.fetch("http://store.test/store/cart/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: unknown }).data;
}

const line = (key: string, quantity: number, variant?: string) => ({
  productId: `${P}product:${key}`,
  productName: key,
  quantity,
  ...(variant ? { variantId: `${P}variant:${key}:${variant}` } : {}),
});

describe("a new store, set up by a run cut short and retried", () => {
  let d1: TestD1;

  beforeAll(async () => {
    d1 = await createTestD1({ worker: await bundleWorker(WORKER, __dirname) });
    await createStore(d1, STORE);
    const defaults = await storeDefaultsSql(STORE, NOW);
    for (const cut of [5, 20, 30]) await apply(d1, defaults.slice(0, cut));
    await setUp(d1, STORE, NOW);
  }, 120_000);

  afterAll(async () => d1?.dispose());

  it("shows the six products, each with its picture from the store's media", async () => {
    const products = await get<any[]>(d1, "/store/products?limit=24");
    expect(products.map((p) => p.handle).sort()).toEqual(STARTER_PRODUCTS.map((p) => p.handle).sort());
    for (const product of products) {
      const source = STARTER_PRODUCTS.find((p) => p.handle === product.handle)!;
      expect(product.name).toBe(source.name.ar);
      expect(product.price).toBe(source.option ? source.option.variants[0]!.price : source.price);
      expect(product.categoryId).toBe(`${P}category:${source.category}`);
      expect(JSON.parse(product.tags)).toEqual(source.tags);
      expect(product.inventory).toBe(source.option ? source.option.variants.reduce((sum, v) => sum + v.inventory, 0) : source.inventory);
      expect(product.coverImage).toMatchObject({ src: `${MEDIA}/products/starter-${source.image}.webp`, width: 1200, height: 1200, altText: source.name.ar });
    }
  });

  it("sells a variant product by its variants, the first one the default", async () => {
    const sneakers = await get(d1, "/store/products/white-sneakers");
    expect(sneakers.hasVariants).toBe(true);
    expect(sneakers.variantOptions).toEqual([{ name: "المقاس", values: ["40", "41", "42", "43", "44"].map((value) => ({ value })) }]);
    expect(sneakers.sku).toBeNull();
    expect(sneakers.variants.map((v: any) => [v.id, v.sku, v.price, v.inventory, v.isDefault])).toEqual(
      ["40", "41", "42", "43", "44"].map((size, i) => [`${P}variant:sneakers:${size}`, `STARTER-WHITE-SNEAKERS-${size}`, 7900, 6, i === 0]),
    );
    expect((await get(d1, "/store/products/wireless-headphones")).sku).toBe("STARTER-WIRELESS-HEADPHONES");
  });

  it("lists the four categories in order, each with a picture", async () => {
    const categories = await get<any[]>(d1, "/store/categories");
    expect(categories.map((c) => [c.slug, c.name, c.imageUrl])).toEqual(
      STARTER_CATEGORIES.map((c) => [c.slug, c.name.ar, `${MEDIA}/products/starter-${c.image}.webp`]),
    );
  });

  it("fills the three default collections, in the starter's order", async () => {
    const handles = async (collection: string) => (await get<any[]>(d1, `/store/products?collection=${collection}`)).map((p) => p.handle);
    expect(await handles("featured")).toEqual(["leather-handbag", "wireless-headphones", "ceramic-table-lamp", "white-sneakers"]);
    expect(await handles("best-sellers")).toEqual(["wireless-headphones", "white-sneakers", "face-serum", "insulated-bottle"]);
    expect(await handles("new-arrivals")).toEqual(["ceramic-table-lamp", "leather-handbag", "insulated-bottle", "face-serum"]);
  });

  it("links the categories in the header menu and two collections in the footer, after the menus' own links", async () => {
    const main = await get(d1, "/store/menus/main-menu");
    expect(main.items.map((item: any) => item.href)).toEqual(["/", "/products", ...STARTER_CATEGORIES.map((c) => `/category/${c.slug}`)]);
    expect(main.items.slice(2).map((item: any) => item.label)).toEqual(STARTER_CATEGORIES.map((c) => c.name.ar));
    const footer = await get(d1, "/store/menus/footer");
    expect(footer.items.map((item: any) => item.href)).toEqual(["/", "/products", "/collections/best-sellers", "/collections/new-arrivals"]);
  });

  it("speaks French, a published language", async () => {
    const sneakers = await get(d1, "/store/products/white-sneakers?locale=fr");
    expect(sneakers.name).toBe("Baskets blanches");
    expect(sneakers.description).toContain("<li>Pointures 40 à 44</li>");
    expect(sneakers.variantOptions[0].name).toBe("Pointure");
    const bottle = await get(d1, "/store/products/insulated-bottle?locale=fr");
    expect(bottle.variantOptions[0].values.map((v: any) => v.value)).toEqual(["500 ml", "750 ml"]);
    const main = await get(d1, "/store/menus/main-menu?locale=fr");
    expect(main.items.slice(2).map((item: any) => item.label)).toEqual(STARTER_CATEGORIES.map((c) => c.name.fr));
    const page = await get(d1, "/store/pages/terms?locale=fr");
    expect(page.locale).toBe("fr");
    expect(page.bodyHtml).toContain("Boutique Amel");
  });

  it("is already translated into English, for when the merchant adds it", async () => {
    const english = await rows<{ resource_type: string }>(d1, "SELECT DISTINCT resource_type FROM translations WHERE locale = 'en' ORDER BY resource_type");
    expect(english.map((r) => r.resource_type)).toEqual(["category", "collection", "menuItem", "offer", "product"]);
    expect(await rows(d1, "SELECT 1 FROM translations WHERE locale = 'ar'")).toEqual([]);
    await d1.raw.prepare("INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('store-1', 'en', 1, ?1)").bind(NOW).run();
    expect((await get(d1, "/store/menus/main-menu?locale=en")).items.map((item: any) => item.label)).toEqual(["Home", "All products", ...STARTER_CATEGORIES.map((c) => c.name.en)]);
    expect((await get(d1, "/store/collections/best-sellers?locale=en")).title).toBe("Best sellers");
    expect((await get(d1, "/store/products/face-serum?locale=en")).name).toBe(STARTER_PRODUCTS.find((p) => p.key === "serum")!.name.en);
  });

  it("quotes delivery to every wilaya, home and stop desk", async () => {
    const rates = await get<Record<string, { home: number; stopDesk: number }>>(d1, "/store/shipping-rates");
    expect(Object.keys(rates)).toHaveLength(58);
    expect(rates["16"]).toEqual({ home: 400, stopDesk: 300 });
    expect(rates["11"]).toEqual({ home: 1200, stopDesk: 900 });
    const toTamanrasset = await quote(d1, { items: [line("lamp", 1)], destination: { wilayaId: 11, deliveryType: "stop_desk" } });
    expect(toTamanrasset.delivery).toEqual({ available: true, fee: 900, total: 6400 });
  });

  it("gives the third bottle when two are bought", async () => {
    const cart = await quote(d1, { items: [line("bottle", 2, "500ml")], destination: { wilayaId: 16 } });
    expect(cart.lines[0]).toMatchObject({ offerId: `${P}offer:bottle-2-plus-1`, lineTotal: 4400 });
    expect(cart.rewards).toEqual([expect.objectContaining({ productId: `${P}product:bottle`, variantId: `${P}variant:bottle:500ml`, quantity: 1 })]);
    expect(cart.delivery).toEqual({ available: true, fee: 400, total: 4800 });
  });

  it("prices three serums at the tier, delivered free when they are the whole basket", async () => {
    const alone = await quote(d1, { items: [line("serum", 3)], destination: { wilayaId: 16 } });
    expect(alone.lines[0]).toMatchObject({ offerId: `${P}offer:serum-tiers`, lineTotal: 5900 });
    expect(alone.freeDelivery.fromOffer).toBe(true);
    expect(alone.delivery).toEqual({ available: true, fee: 0, total: 5900 });
    const two = await quote(d1, { items: [line("serum", 2)], destination: { wilayaId: 16 } });
    expect(two.lines[0].lineTotal).toBe(4300);
    expect(two.delivery.fee).toBe(400);
  });

  it("delivers the sneakers free", async () => {
    const cart = await quote(d1, { items: [line("sneakers", 1, "42")], destination: { wilayaId: 31 } });
    expect(cart.delivery).toEqual({ available: true, fee: 0, total: 7900 });
  });

  it("takes WELCOME10 off, up to 1500 DA, typed in any case", async () => {
    const one = await quote(d1, { items: [line("headphones", 1)], destination: { wilayaId: 16 }, couponCode: "welcome10" });
    expect(one.coupon).toEqual({ code: "WELCOME10", applied: true, discount: 890, freeShipping: false });
    expect(one.delivery).toEqual({ available: true, fee: 400, total: 8410 });
    const two = await quote(d1, { items: [line("headphones", 2)], couponCode: "WELCOME10" });
    expect(two.coupon).toMatchObject({ applied: true, discount: 1500 });
  });

  it("delivers free with FREESHIP from 8000 DA", async () => {
    const enough = await quote(d1, { items: [line("headphones", 1)], destination: { wilayaId: 16 }, couponCode: "FREESHIP" });
    expect(enough.coupon).toEqual({ code: "FREESHIP", applied: true, discount: 0, freeShipping: true });
    expect(enough.delivery).toEqual({ available: true, fee: 0, total: 8900 });
    const short = await quote(d1, { items: [line("lamp", 1)], destination: { wilayaId: 16 }, couponCode: "FREESHIP" });
    expect(short.coupon).toEqual({ code: "FREESHIP", applied: false, reason: "below_minimum_subtotal", shortBy: 2500 });
  });

  it("writes the legal pages the dashboard's button writes", async () => {
    const twin: StarterStore = { ...STORE, id: "store-2" };
    await createStore(d1, twin);
    const res = await d1.fetch("http://store.test/seed-pages/store-2", { method: "POST" });
    expect(await res.json()).toEqual({ created: ["terms", "privacy", "refund", "shipping"] });
    const pages = (store: string) =>
      rows(
        d1,
        `SELECT p.kind, p.slug, p.status, p.show_in_footer, p.position, p.template_version, t.locale, t.title, t.body_html, t.body_plain, t.meta_title, t.meta_description, t.source
         FROM store_pages p JOIN store_page_translations t ON t.page_id = p.id WHERE p.store_id = ?1 ORDER BY p.position, t.locale`,
        store,
      );
    const seeded = await pages("store-1");
    expect(seeded).toHaveLength(12);
    expect(seeded).toEqual(await pages("store-2"));
  });

  it("changes nothing when it runs again", async () => {
    const before = await snapshot(d1);
    await setUp(d1, STORE, LATER);
    expect(await snapshot(d1)).toEqual(before);
  });

  it("goes away like the merchant's own data, its pictures with it when nothing else shows them", async () => {
    const remove = async (key: string) => (await (await d1.fetch(`http://store.test/remove-product/${P}product:${key}`, { method: "POST" })).json()) as { removed: unknown; deleted: string[] };

    const bottle = await remove("bottle");
    expect(bottle.removed).toMatchObject({ removedImages: 1 });
    expect(bottle.deleted).toEqual(["products/starter-bottle.webp"]);
    const id = `${P}product:bottle`;
    for (const [table, column] of [["product_variants", "product_id"], ["product_images", "product_id"], ["collection_products", "product_id"], ["offers", "trigger_product_id"], ["translations", "resource_id"]] as const) {
      expect(await rows(d1, `SELECT 1 FROM ${table} WHERE ${column} = ?1`, id), table).toEqual([]);
    }
    expect(await rows(d1, "SELECT 1 FROM translations WHERE resource_id = ?1", `${P}offer:bottle-2-plus-1`)).toEqual([]);

    const handbag = await remove("handbag");
    expect(handbag.deleted).toEqual([]);
    expect((await get<any[]>(d1, "/store/categories"))[0].imageUrl).toBe(`${MEDIA}/products/starter-handbag.webp`);
  });
});

describe("a store that has its own data", () => {
  let d1: TestD1;

  beforeAll(async () => {
    d1 = await createTestD1();
    await createStore(d1, STORE);
  }, 120_000);

  afterAll(async () => d1?.dispose());

  const starterRows = async () => {
    const counts: Record<string, number> = {};
    for (const table of ["products", "product_categories", "product_variants", "product_images", "offers", "coupons", "store_menu_items", "translations"]) {
      const column = table === "translations" ? "resource_id" : "id";
      counts[table] = (await rows<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ?1`, `${P}%`))[0]!.n;
    }
    return counts;
  };
  const none = { products: 0, product_categories: 0, product_variants: 0, product_images: 0, offers: 0, coupons: 0, store_menu_items: 0, translations: 0 };

  it("gets no starter catalog when it has a category", async () => {
    await d1.raw.prepare("INSERT INTO product_categories (id, name, slug, position, created_at, updated_at) VALUES ('c1', 'Robes', 'robes', 1, ?1, ?1)").bind(NOW).run();
    await setUp(d1, STORE, NOW);
    expect(await starterRows()).toEqual(none);
    await d1.raw.prepare("DELETE FROM product_categories WHERE id = 'c1'").run();
  });

  it("gets no starter catalog when it has a product, but every default it lacks", async () => {
    await d1.raw.prepare("INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe kabyle', 'robe-kabyle', 9000, ?1, ?1)").bind(NOW).run();
    await setUp(d1, STORE, LATER);
    expect(await starterRows()).toEqual(none);
    expect(await rows(d1, "SELECT handle FROM store_menus ORDER BY handle")).toEqual([{ handle: "footer" }, { handle: "main-menu" }]);
    expect(await rows(d1, "SELECT handle FROM collections ORDER BY handle")).toEqual([{ handle: "best-sellers" }, { handle: "featured" }, { handle: "new-arrivals" }]);
    expect(await rows(d1, "SELECT kind FROM store_pages ORDER BY position")).toEqual(["terms", "privacy", "refund", "shipping"].map((kind) => ({ kind })));
    expect(await rows(d1, "SELECT COUNT(*) AS n FROM shipping_rules")).toEqual([{ n: 58 }]);
  });

  it("keeps what the merchant set: their default shipping profile, their header menu, their pages", async () => {
    const fresh = await createTestD1();
    try {
      await createStore(fresh, STORE);
      await fresh.raw.batch([
        fresh.raw.prepare("INSERT INTO shipping_profiles (id, name, is_default, created_at, updated_at) VALUES ('mine', 'Yalidine', 1, ?1, ?1)").bind(NOW),
        fresh.raw.prepare("INSERT INTO store_pages (id, store_id, kind, slug, status, show_in_footer, position, template_version, created_at, updated_at) VALUES ('my-terms', 'store-1', 'terms', 'conditions', 'draft', 0, 9, 1, ?1, ?1)").bind(NOW),
        fresh.raw.prepare("INSERT INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES ('my-menu', 'store-1', 'main-menu', 'Menu', ?1, ?1)").bind(NOW),
        fresh.raw.prepare("INSERT INTO collections (id, store_id, handle, title, created_at, updated_at) VALUES ('my-picks', 'store-1', 'featured', 'Coups de cœur', ?1, ?1)").bind(NOW),
      ]);
      await setUp(fresh, STORE, LATER);
      expect(await rows(fresh, "SELECT id FROM shipping_profiles")).toEqual([{ id: "mine" }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM shipping_rules")).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT id, slug, status FROM store_pages WHERE kind = 'terms'")).toEqual([{ id: "my-terms", slug: "conditions", status: "draft" }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM store_page_translations WHERE page_id = 'my-terms'")).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT id FROM store_menus WHERE handle = 'main-menu'")).toEqual([{ id: "my-menu" }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM store_menu_items WHERE menu_id = 'my-menu'")).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM translations WHERE resource_id LIKE ?1", `${STORE.id}:menu:main-menu:%`)).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM translations WHERE resource_id LIKE ?1", `${P}menu:main-menu:%`)).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT id, title FROM collections WHERE handle = 'featured'")).toEqual([{ id: "my-picks", title: "Coups de cœur" }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM collection_products WHERE collection_id = 'my-picks'")).toEqual([{ n: 0 }]);
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM collection_products")).toEqual([{ n: 8 }]);

      const footer = await rows<{ id: string }>(fresh, "SELECT id FROM store_menu_items WHERE menu_id = 'store-1:menu:footer' ORDER BY position");
      expect(footer.map((item) => item.id)).toEqual(["home", "catalog", "best-sellers", "new-arrivals"].map((key, i) => (i < 2 ? `store-1:menu:footer:${key}` : `${P}menu:footer:${key}`)));
      await fresh.raw.prepare("DELETE FROM store_menu_items WHERE id = ?1").bind(footer[1]!.id).run();
      await setUp(fresh, STORE, "2026-12-01T00:00:00.000Z");
      expect(await rows(fresh, "SELECT COUNT(*) AS n FROM store_menu_items WHERE menu_id = 'store-1:menu:footer'")).toEqual([{ n: footer.length - 1 }]);
    } finally {
      await fresh.dispose();
    }
  }, 120_000);

  it("keeps delivering free when it already sells without a shipping profile", async () => {
    const selling = await createTestD1();
    try {
      await createStore(selling, STORE);
      await selling.raw.batch([
        selling.raw.prepare("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0555000000', 'Alger', ?1)").bind(NOW),
        selling.raw.prepare("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('o1', 'CF-1', 'c1', 'Amel', '0555000000', 3000, ?1, ?1)").bind(NOW),
      ]);
      await setUp(selling, STORE, LATER);
      expect(await rows(selling, "SELECT COUNT(*) AS n FROM shipping_profiles")).toEqual([{ n: 0 }]);
      expect(await rows(selling, "SELECT COUNT(*) AS n FROM shipping_rules")).toEqual([{ n: 0 }]);
      expect(await rows(selling, "SELECT COUNT(*) AS n FROM store_pages")).toEqual([{ n: 4 }]);
    } finally {
      await selling.dispose();
    }
  }, 120_000);

  it("gets the starter once its own product is gone, its links after the merchant's", async () => {
    await d1.raw.prepare("DELETE FROM products WHERE id = 'p1'").run();
    await d1.raw.prepare("INSERT INTO store_menu_items (id, menu_id, position, label, destination_type, url, created_at, updated_at) VALUES ('mine', 'store-1:menu:footer', 7, 'Contact', 'url', 'https://wa.me/213555000000', ?1, ?1)").bind(NOW).run();
    await setUp(d1, STORE, LATER);
    const counts = await starterRows();
    expect(counts.products).toBe(STARTER_PRODUCTS.length);
    expect(counts.product_images).toBe(STARTER_IMAGES.length);
    const footer = await rows<{ id: string; position: number }>(d1, "SELECT id, position FROM store_menu_items WHERE menu_id = 'store-1:menu:footer' AND parent_id IS NULL ORDER BY position");
    expect(footer.slice(-3).map((item) => item.id)).toEqual(["mine", `${P}menu:footer:best-sellers`, `${P}menu:footer:new-arrivals`]);
    expect(footer.slice(-2).map((item) => item.position)).toEqual([8, 9]);
  });
});
