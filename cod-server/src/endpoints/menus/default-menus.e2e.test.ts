/**
 * Every store starts with `main-menu` and `footer` (store setup runs
 * `defaultMenusSql`). Real D1, real migrations, the real store route:
 * the menus read in each of the store's languages, re-running setup changes
 * nothing, and a menu the store already has is never touched.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultMenusSql } from "../../../../cod-shared/navigation/default-menus";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";

const T = "2026-10-01T00:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as AppContext["Bindings"];
    c.set("storeId", "s1");
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRoutes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of ["translations", "store_menu_items", "store_menus", "store_locales", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.run(sql`INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Boutique', 'fr', ${T}, ${T})`);
  await d1.db.run(sql`INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s1', 'fr', 1, ${T}), ('s1', 'ar', 1, ${T})`);
});

const seed = async (now: string) => {
  for (const statement of await defaultMenusSql({ id: "s1", lang: "fr" }, now)) await d1.raw.prepare(statement).run();
};
const menu = async (handle: string, locale = "") => {
  const response = await app.request(`/store/menus/${handle}${locale ? `?locale=${locale}` : ""}`);
  return { status: response.status, body: (await response.json()) as { data: { title: string; items: { label: string; href: string }[] } } };
};

describe("default menus", () => {
  it("give a store main-menu and footer, in its primary language and translated", async () => {
    await seed("2026-10-02T00:00:00.000Z");
    const header = await menu("main-menu");
    expect(header.status).toBe(200);
    expect(header.body.data.items).toEqual([
      { label: "Accueil", href: "/", type: "home", children: [] },
      { label: "Tous les produits", href: "/products", type: "catalog", children: [] },
    ]);
    expect((await menu("main-menu", "ar")).body.data.items.map((item) => item.label)).toEqual(["الرئيسية", "كل المنتجات"]);
    expect((await menu("footer")).body.data.items).toEqual([
      { label: "Accueil", href: "/", type: "home", children: [] },
      { label: "Tous les produits", href: "/products", type: "catalog", children: [] },
      { label: "Suivre ma commande", href: "/track-order", type: "trackOrder", children: [] },
      { label: "Contact", href: "/contact", type: "contact", children: [] },
    ]);
    expect((await menu("footer", "ar")).body.data.items.map((item) => item.label)).toEqual(["الرئيسية", "كل المنتجات", "تتبع طلبي", "اتصل بنا"]);
  });

  it("change nothing when setup runs again, nor bring back an item the merchant removed", async () => {
    await seed("2026-10-02T00:00:00.000Z");
    await d1.raw.prepare("DELETE FROM store_menu_items WHERE id = 's1:menu:main-menu:catalog'").run();
    await d1.raw.prepare("UPDATE store_menus SET title = 'En-tête' WHERE handle = 'main-menu'").run();
    await seed("2026-10-03T00:00:00.000Z");
    const header = await menu("main-menu");
    expect(header.body.data.title).toBe("En-tête");
    expect(header.body.data.items.map((item) => item.label)).toEqual(["Accueil"]);
    expect((await d1.raw.prepare("SELECT count(*) AS n FROM store_menus").first<{ n: number }>())?.n).toBe(2);
  });

  it("never touch a menu the store already has under the handle", async () => {
    await d1.raw.prepare(`INSERT INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES ('mine', 's1', 'main-menu', 'Le mien', '${T}', '${T}')`).run();
    await seed("2026-10-02T00:00:00.000Z");
    const header = await menu("main-menu");
    expect(header.body.data).toMatchObject({ title: "Le mien", items: [] });
    expect((await menu("footer")).body.data.items).toHaveLength(4);
  });
});
