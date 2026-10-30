/**
 * Navigation menus and theme settings (migration 0045) — real D1, real
 * migrations, real routes.
 *
 *  1. The database keeps a menu coherent on its own: a handle is a handle, an
 *     item points at exactly one kind of destination, and deleting a store, a
 *     menu or a parent item takes everything under it — translations too.
 *  2. The merchant builds a menu as one tree; an item kept by id keeps its
 *     translations, an item moved out from under a removed parent survives.
 *  3. A shopper sees only links that lead somewhere, in their language.
 *  4. The storefront config carries the requesting theme's settings.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { signIn } from "@/test-utils/sign-in";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";
import menusRouter from "./routes";
import { TEST_MEDIA_VARS } from "@/test-utils/media";

const STORE_ID = "store-menus";
const T = "2026-10-01T00:00:00.000Z";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, ...TEST_MEDIA_VARS } as AppContext["Bindings"];
    c.set("storeId", STORE_ID);
    signIn(c, { id: "admin", name: "Admin", role: "admin", status: "active", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRoutes);
  app.route("/api/menus", menusRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of ["translations", "store_menu_items", "store_menus", "store_theme_settings", "store_pages", "landing_pages", "products", "product_categories", "store_locales", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE_ID, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.storeLocales).values([
    { storeId: STORE_ID, locale: "fr", published: true, createdAt: T },
    { storeId: STORE_ID, locale: "ar", published: true, createdAt: T },
  ]);
  await d1.db.insert(schema.productCategories).values([{ id: "cat1", name: "Robes", slug: "robes", createdAt: T, updatedAt: T }]);
  await d1.db.insert(schema.products).values([
    { id: "p1", name: "Robe", handle: "robe été", sku: "R1", price: 1500, createdAt: T, updatedAt: T },
    { id: "p2", name: "Brouillon", handle: "brouillon", sku: "R2", price: 1500, status: "DRAFT", createdAt: T, updatedAt: T },
    { id: "p3", name: "Non listé", handle: "cache", sku: "R3", price: 1500, showInStore: false, createdAt: T, updatedAt: T },
  ]);
  await d1.db.insert(schema.storePages).values([
    { id: "sp1", storeId: STORE_ID, kind: "terms", slug: "conditions", createdAt: T, updatedAt: T },
    { id: "sp2", storeId: STORE_ID, kind: "custom", slug: "bientot", status: "draft", createdAt: T, updatedAt: T },
  ]);
  await d1.db.insert(schema.landingPages).values([
    { id: "lp1", slug: "promo", name: "Promo", productId: "p1", status: "published", createdAt: T, updatedAt: T },
    { id: "lp2", slug: "projet", name: "Projet", productId: "p1", createdAt: T, updatedAt: T },
  ]);
});

const call = async (method: string, path: string, body?: unknown) => {
  const response = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
};

const createMenu = async (handle = "main-menu", title = "Menu principal") => (await call("POST", "/api/menus", { handle, title })).body.data.id as string;

const itemIds = async () => (await d1.db.select({ id: schema.storeMenuItems.id }).from(schema.storeMenuItems).all()).map((row) => row.id).sort();

const translate = (resourceId: string, locale: string, value: string) =>
  d1.db.insert(schema.translations).values({ resourceType: "menuItem", resourceId, locale, key: "label", value, sourceDigest: "d", updatedAt: T } as never);

const labelsOf = async () => (await d1.db.select({ id: schema.translations.resourceId }).from(schema.translations).all()).map((row) => row.id).sort();

describe("the database keeps menus coherent (migration 0045)", () => {
  const insertMenu = (id: string, handle: string) =>
    d1.raw.prepare("INSERT INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES (?, ?, ?, 'M', ?, ?)").bind(id, STORE_ID, handle, T, T).run();
  const insertItem = (id: string, menuId: string, parentId: string | null, type: string, ref: string | null, url: string | null) =>
    d1.raw
      .prepare("INSERT INTO store_menu_items (id, menu_id, parent_id, label, destination_type, destination_ref, url, created_at, updated_at) VALUES (?, ?, ?, 'L', ?, ?, ?, ?, ?)")
      .bind(id, menuId, parentId, type, ref, url, T, T)
      .run();

  it("refuses a handle that is not one, and the same handle twice in a store", async () => {
    for (const handle of ["Main", "-main", "main menu", "", "a".repeat(65)]) await expect(insertMenu(`m-${handle}`, handle)).rejects.toThrow();
    await insertMenu("m1", "main-menu");
    await expect(insertMenu("m2", "main-menu")).rejects.toThrow();
  });

  it("refuses an item whose destination is incomplete or mixed", async () => {
    await insertMenu("m1", "main-menu");
    await expect(insertItem("i1", "m1", null, "url", null, null)).rejects.toThrow();
    await expect(insertItem("i2", "m1", null, "product", null, null)).rejects.toThrow();
    await expect(insertItem("i3", "m1", null, "home", "p1", null)).rejects.toThrow();
    await expect(insertItem("i4", "m1", null, "home", null, "/x")).rejects.toThrow();
    await expect(insertItem("i5", "m1", null, "blog", null, null)).rejects.toThrow();
    await insertItem("ok1", "m1", null, "url", null, "/pages/faq");
    await insertItem("ok2", "m1", null, "product", "p1", null);
    await insertItem("ok3", "m1", null, "catalog", null, null);
    expect(await itemIds()).toEqual(["ok1", "ok2", "ok3"]);
  });

  it("deletes a parent's children, and every deleted item's translations, however it goes", async () => {
    await insertMenu("m1", "main-menu");
    await insertItem("a", "m1", null, "home", null, null);
    await insertItem("b", "m1", "a", "catalog", null, null);
    await insertItem("c", "m1", "b", "catalog", null, null);
    await insertItem("d", "m1", null, "catalog", null, null);
    for (const id of ["a", "b", "c", "d"]) await translate(id, "ar", `ar-${id}`);

    await d1.raw.prepare("DELETE FROM store_menu_items WHERE id = 'a'").run();
    expect(await itemIds()).toEqual(["d"]);
    expect(await labelsOf()).toEqual(["d"]);

    await d1.raw.prepare("DELETE FROM store_menus WHERE id = 'm1'").run();
    expect(await itemIds()).toEqual([]);
    expect(await labelsOf()).toEqual([]);
  });

  it("goes with its store, settings and menus alike", async () => {
    await insertMenu("m1", "main-menu");
    await insertItem("a", "m1", null, "home", null, null);
    await d1.raw.prepare(`INSERT INTO store_theme_settings (store_id, theme_key, "values", updated_at) VALUES (?, 'theme-00', '{}', ?)`).bind(STORE_ID, T).run();
    await d1.raw.prepare("DELETE FROM store_locales").run();
    await d1.raw.prepare("DELETE FROM store_pages").run();
    await d1.raw.prepare("DELETE FROM stores").run();
    expect(await d1.db.select().from(schema.storeMenus).all()).toEqual([]);
    expect(await itemIds()).toEqual([]);
    expect(await d1.db.select().from(schema.storeThemeSettings).all()).toEqual([]);
  });

  it("stores theme settings only as a JSON object", async () => {
    const save = (themeKey: string, values: string) =>
      d1.raw.prepare(`INSERT INTO store_theme_settings (store_id, theme_key, "values", updated_at) VALUES (?, ?, ?, ?)`).bind(STORE_ID, themeKey, values, T).run();
    await expect(save("a", "[1]")).rejects.toThrow();
    await expect(save("b", "nope")).rejects.toThrow();
    await expect(save("c", '"x"')).rejects.toThrow();
    await save("theme-00", '{"font":"Cairo"}');
    await expect(save("theme-00", "{}")).rejects.toThrow();
  });
});

describe("the merchant builds a menu", () => {
  it("creates a menu, refuses its handle twice, and renames it", async () => {
    const created = await call("POST", "/api/menus", { handle: "main-menu", title: "Menu principal" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ handle: "main-menu", title: "Menu principal", items: [] });
    expect(await call("POST", "/api/menus", { handle: "main-menu", title: "Autre" })).toMatchObject({ status: 409, body: { code: "DUPLICATE_MENU_HANDLE" } });
    expect((await call("POST", "/api/menus", { handle: "Main Menu", title: "Autre" })).status).toBe(400);

    const footer = await createMenu("footer", "Pied de page");
    expect((await call("PATCH", `/api/menus/${footer}`, { handle: "main-menu" })).status).toBe(409);
    expect((await call("PATCH", `/api/menus/${footer}`, { handle: "footer", title: "Bas de page" })).body.data).toMatchObject({ handle: "footer", title: "Bas de page" });
    expect((await call("PATCH", "/api/menus/nope", { title: "x" })).status).toBe(404);

    const listed = (await call("GET", "/api/menus")).body;
    expect(listed.data.map((menu: { handle: string }) => menu.handle)).toEqual(["main-menu", "footer"]);
  });

  it("saves the tree as sent, and says which destinations a shopper cannot reach", async () => {
    const id = await createMenu();
    const saved = await call("PUT", `/api/menus/${id}/items`, {
      items: [
        { label: "Accueil", destination: { type: "home" } },
        {
          label: "Boutique",
          destination: { type: "catalog" },
          children: [
            { label: "Robes", destination: { type: "category", ref: "cat1" }, children: [{ label: "Robe", destination: { type: "product", ref: "p1" } }] },
            { label: "Brouillon", destination: { type: "product", ref: "p2" } },
            { label: "Disparu", destination: { type: "product", ref: "gone" } },
          ],
        },
        { label: "Conditions", destination: { type: "page", ref: "sp1" } },
        { label: "Promo", destination: { type: "landing", ref: "lp1" } },
        { label: "Instagram", destination: { type: "url", url: "https://instagram.com/boutique" } },
      ],
    });
    expect(saved.status).toBe(200);
    const [home, shop, terms, promo, instagram] = saved.body.data.items;
    expect(home).toMatchObject({ label: "Accueil", destinationStatus: "ok", destinationLabel: null, children: [] });
    expect(shop.children.map((item: any) => [item.label, item.destinationStatus, item.destinationLabel])).toEqual([
      ["Robes", "ok", "Robes"],
      ["Brouillon", "hidden", "Brouillon"],
      ["Disparu", "missing", null],
    ]);
    expect(shop.children[0].children[0]).toMatchObject({ label: "Robe", destination: { type: "product", ref: "p1" }, destinationStatus: "ok" });
    expect(terms).toMatchObject({ destinationStatus: "ok", destinationLabel: "conditions" });
    expect(promo).toMatchObject({ destinationStatus: "ok", destinationLabel: "Promo" });
    expect(instagram).toMatchObject({ destination: { type: "url", url: "https://instagram.com/boutique" }, destinationStatus: "ok" });
    expect((await call("GET", `/api/menus/${id}`)).body.data.items).toEqual(saved.body.data.items);
    expect((await call("GET", "/api/menus")).body.data[0].itemCount).toBe(9);
  });

  it("refuses a fourth level, an unsafe URL, too many items, and one item twice — and writes nothing", async () => {
    const id = await createMenu();
    const leaf = { label: "x", destination: { type: "home" } };
    const tooDeep = { items: [{ ...leaf, children: [{ ...leaf, children: [{ ...leaf, children: [leaf] }] }] }] };
    expect((await call("PUT", `/api/menus/${id}/items`, tooDeep)).status).toBe(400);
    for (const url of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "has space"]) {
      expect((await call("PUT", `/api/menus/${id}/items`, { items: [{ label: "x", destination: { type: "url", url } }] })).status).toBe(400);
    }
    const tooMany = await call("PUT", `/api/menus/${id}/items`, { items: Array.from({ length: 101 }, () => leaf) });
    expect(tooMany).toMatchObject({ status: 400, body: { code: "INVALID_MENU_ITEMS" } });
    expect((await call("PUT", `/api/menus/${id}/items`, { items: [{ ...leaf, id: "same" }, { ...leaf, id: "same" }] })).status).toBe(400);
    expect((await call("PUT", "/api/menus/nope/items", { items: [] })).status).toBe(404);
    expect(await itemIds()).toEqual([]);
  });

  it("keeps an item sent with its id, and its translations; deletes what was left out with theirs", async () => {
    const id = await createMenu();
    const first = (
      await call("PUT", `/api/menus/${id}/items`, {
        items: [
          { label: "Boutique", destination: { type: "catalog" }, children: [{ label: "Robes", destination: { type: "category", ref: "cat1" } }] },
          { label: "Ancien", destination: { type: "home" } },
        ],
      })
    ).body.data.items;
    const [shop, old] = first;
    const robes = shop.children[0];
    for (const item of [shop, robes, old]) await translate(item.id, "ar", `ar-${item.label}`);

    const second = await call("PUT", `/api/menus/${id}/items`, {
      items: [
        { id: robes.id, label: "Robes d'été", destination: { type: "category", ref: "cat1" } },
        { id: "not-of-this-menu", label: "Nouveau", destination: { type: "home" }, children: [{ label: "Sous", destination: { type: "catalog" } }] },
      ],
    });
    expect(second.status).toBe(200);
    const [movedRobes, fresh] = second.body.data.items;
    expect(movedRobes).toMatchObject({ id: robes.id, label: "Robes d'été", children: [] });
    expect(fresh.id).not.toBe("not-of-this-menu");
    expect(fresh.children).toHaveLength(1);
    expect(await itemIds()).toEqual([robes.id, fresh.id, fresh.children[0].id].sort());
    expect(await labelsOf()).toEqual([robes.id]);
  });

  it("finds what an item can point at, by name or slug, with its path and whether shoppers see it", async () => {
    const found = async (type: string, q = "") => (await call("GET", `/api/menus/destinations?type=${type}&q=${encodeURIComponent(q)}`)).body.data;
    expect(await found("product", "rob")).toEqual([{ id: "p1", label: "Robe", path: "/products/robe%20%C3%A9t%C3%A9", visible: true }]);
    expect((await found("product")).map((option: { id: string; visible: boolean }) => [option.id, option.visible]).sort()).toEqual([["p1", true], ["p2", false], ["p3", false]]);
    expect(await found("category", "robes")).toEqual([{ id: "cat1", label: "Robes", path: "/category/robes", visible: true }]);
    expect(await found("page")).toEqual([
      { id: "sp2", label: "bientot", path: "/pages/bientot", visible: false },
      { id: "sp1", label: "conditions", path: "/pages/conditions", visible: true },
    ]);
    expect((await found("landing", "pro")).map((option: { id: string }) => option.id).sort()).toEqual(["lp1", "lp2"]);
    expect(await found("product", "nothing-like-this")).toEqual([]);
    expect((await call("GET", "/api/menus/destinations?type=url")).status).toBe(400);
  });

  it("deletes a menu with its items and their translations", async () => {
    const id = await createMenu();
    const [item] = (await call("PUT", `/api/menus/${id}/items`, { items: [{ label: "x", destination: { type: "home" } }] })).body.data.items;
    await translate(item.id, "ar", "س");
    expect((await call("DELETE", `/api/menus/${id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/menus/${id}`)).status).toBe(404);
    expect(await itemIds()).toEqual([]);
    expect(await labelsOf()).toEqual([]);
  });
});

describe("a shopper's menu", () => {
  beforeEach(async () => {
    const id = await createMenu();
    const items = (
      await call("PUT", `/api/menus/${id}/items`, {
        items: [
          { label: "Accueil", destination: { type: "home" } },
          {
            label: "Boutique",
            destination: { type: "catalog" },
            children: [
              { label: "Robes", destination: { type: "category", ref: "cat1" }, children: [{ label: "Robe", destination: { type: "product", ref: "p1" } }] },
              { label: "Brouillon", destination: { type: "product", ref: "p2" } },
              { label: "Non listé", destination: { type: "product", ref: "p3" } },
            ],
          },
          { label: "Bientôt", destination: { type: "page", ref: "sp2" }, children: [{ label: "Sous-page", destination: { type: "home" } }] },
          { label: "Projet", destination: { type: "landing", ref: "lp2" } },
          { label: "Disparu", destination: { type: "category", ref: "gone" } },
          { label: "Conditions", destination: { type: "page", ref: "sp1" } },
          { label: "Promo", destination: { type: "landing", ref: "lp1" } },
          { label: "Contact", destination: { type: "url", url: "mailto:contact@boutique.dz" } },
        ],
      })
    ).body.data.items;
    await translate(items[0].id, "ar", "الرئيسية");
    await translate(items[1].children[0].id, "ar", "  ");
  });

  it("holds only links that lead somewhere, as paths of the store", async () => {
    const { status, body } = await call("GET", "/store/menus/main-menu");
    expect(status).toBe(200);
    expect(body.data).toEqual({
      handle: "main-menu",
      title: "Menu principal",
      items: [
        { label: "Accueil", href: "/", type: "home", children: [] },
        {
          label: "Boutique",
          href: "/products",
          type: "catalog",
          children: [{ label: "Robes", href: "/category/robes", type: "category", children: [{ label: "Robe", href: "/products/robe%20%C3%A9t%C3%A9", type: "product", children: [] }] }],
        },
        { label: "Conditions", href: "/pages/conditions", type: "page", children: [] },
        { label: "Promo", href: "/lp/promo", type: "landing", children: [] },
        { label: "Contact", href: "mailto:contact@boutique.dz", type: "url", children: [] },
      ],
    });
  });

  it("speaks the shopper's language where the store translated a label, the primary elsewhere", async () => {
    const ar = await app.request("/store/menus/main-menu?locale=ar");
    expect(ar.headers.get("content-language")).toBe("ar");
    const items = ((await ar.json()) as any).data.items;
    expect(items[0].label).toBe("الرئيسية");
    expect(items[1].children[0].label).toBe("Robes");
    expect(((await call("GET", "/store/menus/main-menu?locale=en")).body.data.items[0].label)).toBe("Accueil");
  });

  it("takes a label translated through the dashboard's translations route", async () => {
    const menu = (await call("GET", "/api/menus")).body.data[0];
    const promo = (await call("GET", `/api/menus/${menu.id}`)).body.data.items.find((item: { label: string }) => item.label === "Promo");
    const written = await call("PATCH", `/api/menus/items/${promo.id}/translations`, { locale: "ar", values: { label: "عرض" } });
    expect(written.status).toBe(200);
    expect((await call("GET", `/api/menus/items/${promo.id}/translations`)).body.data.translations.ar.label).toEqual({ value: "عرض", outdated: false });
    expect((await call("PATCH", `/api/menus/items/${promo.id}/translations`, { locale: "ar", values: { title: "x" } })).status).toBe(400);
    const items = (await call("GET", "/store/menus/main-menu?locale=ar")).body.data.items;
    expect(items.find((item: { href: string }) => item.href === "/lp/promo").label).toBe("عرض");
  });

  it("is a 404 for a handle the store does not have", async () => {
    expect((await call("GET", "/store/menus/footer")).status).toBe(404);
    expect((await call("GET", "/store/menus/Not%20A%20Handle")).status).toBe(400);
  });

  it("follows the catalog: a product put back on sale reappears, a deleted one is gone", async () => {
    await d1.db.update(schema.products).set({ status: "ACTIVE" }).where(eq(schema.products.id, "p2"));
    await d1.db.delete(schema.productCategories).where(eq(schema.productCategories.id, "cat1"));
    const shop = (await call("GET", "/store/menus/main-menu")).body.data.items[1];
    expect(shop.children).toEqual([{ label: "Brouillon", href: "/products/brouillon", type: "product", children: [] }]);
  });
});

describe("the storefront config carries the theme's settings", () => {
  it("as saved, for the requesting theme only", async () => {
    await d1.db.insert(schema.storeThemeSettings).values([
      { storeId: STORE_ID, themeKey: "theme-00", values: '{"font":"Tajawal","headerMenu":"main-menu"}', updatedAt: T },
      { storeId: STORE_ID, themeKey: "other", values: '{"font":"Cairo"}', updatedAt: T },
    ]);
    expect((await call("GET", "/store/config?theme=theme-00")).body.data.themeSettings).toEqual({ font: "Tajawal", headerMenu: "main-menu" });
    expect((await call("GET", "/store/config?theme=fresh")).body.data.themeSettings).toEqual({});
    expect((await call("GET", "/store/config")).body.data.themeSettings).toEqual({});
  });
});
