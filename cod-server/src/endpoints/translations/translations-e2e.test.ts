/**
 * Translations of merchant data (ADR 0005, phase C) — real D1, real
 * migrations, real routes.
 *
 *  1. Editors read a resource's source text and every translation, each
 *     flagged outdated once its source changes; they write one language at a
 *     time, never the primary and never a language the store has not added,
 *     with the resource's own scopes.
 *  2. Storefront reads take `?locale=`: a published language is served with
 *     its translations, field by field, falling back to the primary; any
 *     other request is served in the primary — and `Content-Language` says
 *     which one it got.
 *  3. Deleting a resource, or removing a language, removes its translations.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";

const now = () => new Date().toISOString();
const STORE_ID = "store-1";

/**
 * The real routers, in the real Workers runtime: translated descriptions go
 * through the HTMLRewriter sanitiser, which the Node pool does not have. The
 * signed-in user and the storefront's store arrive as test headers, standing
 * in for the auth middlewares this test is not about.
 */
const WORKER = `
import { OpenAPIHono } from "@hono/zod-openapi";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import offersRouter from "../offers/routes";
import productGroupsRouter from "../product-groups/routes";
import productsRouter from "../products/routes";
import storeRoutes from "../store/routes";
import storesRouter from "../stores/routes";

const app = new OpenAPIHono({ defaultHook: openApiValidationHook });
app.use("*", async (c, next) => {
  c.set("storeId", "${STORE_ID}");
  c.set("user", JSON.parse(c.req.header("x-test-user") ?? "null"));
  await next();
});
app.onError(errorHandler);
app.route("/store", storeRoutes);
app.route("/api/products", productsRouter);
app.route("/api/product-groups", productGroupsRouter);
app.route("/api/offers", offersRouter);
app.route("/api/stores", storesRouter);
export default app;
`;

let harness: TestD1;
let user: { id: string; role: string; status: string; scopes: string[] };

const request = async (path: string, init?: { method: string; body: unknown }) => {
  const res = await harness.fetch(`http://test${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "x-test-user": JSON.stringify(user) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, language: res.headers.get("Content-Language"), body: (await res.json()) as any };
};

const translate = (path: string, locale: string, values: Record<string, unknown>) =>
  request(path, { method: "PATCH", body: { locale, values } });

beforeAll(async () => {
  harness = await createTestD1({ worker: await bundleWorker(WORKER, __dirname) });
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  user = { id: "admin", role: "admin", status: "active", scopes: [] };
  for (const table of [schema.offers, schema.products, schema.productCategories, schema.storePages, schema.stores]) {
    await harness.db.delete(table);
  }
  await harness.db.delete(schema.translations);
  await harness.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "متجر",
    lang: "ar",
    announcementBar: "توصيل مجاني",
    metaTitle: "متجر الجزائر",
    createdAt: now(),
    updatedAt: now(),
  });
  await harness.db.insert(schema.storeLocales).values([
    { storeId: STORE_ID, locale: "ar", published: true, createdAt: now() },
    { storeId: STORE_ID, locale: "fr", published: true, createdAt: now() },
    { storeId: STORE_ID, locale: "en", published: false, createdAt: now() },
  ]);
  await harness.db.insert(schema.productCategories).values({
    id: "cat-1",
    name: "هواتف",
    slug: "phones",
    metaTitle: "هواتف ذكية",
    createdAt: now(),
    updatedAt: now(),
  });
  await harness.db.insert(schema.products).values([
    {
      id: "p-1",
      name: "هاتف",
      description: "<p>وصف الهاتف</p>",
      descriptionFormat: "html",
      handle: "phone",
      price: 30000,
      categoryId: "cat-1",
      createdAt: now(),
      updatedAt: now(),
    },
    { id: "p-2", name: "سماعات", handle: "buds", price: 2000, createdAt: now(), updatedAt: now() },
  ]);
  await harness.db.insert(schema.offers).values({
    id: "o-1",
    name: "اشتر 2 واحصل على هدية",
    triggerProductId: "p-1",
    rewardProductId: "p-2",
    createdAt: now(),
    updatedAt: now(),
  });
});

const storedKeys = async (resource: string) =>
  (
    await harness.db
      .select({ id: schema.translations.resourceId, locale: schema.translations.locale, key: schema.translations.key })
      .from(schema.translations)
      .where(eq(schema.translations.resourceType, resource))
      .orderBy(schema.translations.resourceId, schema.translations.locale, schema.translations.key)
      .all()
  ).map((row) => `${row.id}:${row.locale}:${row.key}`);

describe("editing translations", () => {
  it("shows the source in the primary language and no translations yet", async () => {
    const { status, body } = await request("/api/products/p-1/translations");
    expect(status).toBe(200);
    expect(body.data).toEqual({
      resource: "product",
      id: "p-1",
      sourceLocale: "ar",
      targetLocales: [
        { locale: "fr", published: true },
        { locale: "en", published: false },
      ],
      source: { name: "هاتف", description: "<p>وصف الهاتف</p>" },
      translations: {},
    });
  });

  it("writes one language, sanitising HTML exactly like the source", async () => {
    const { status, body } = await translate("/api/products/p-1/translations", "fr", {
      name: "Téléphone",
      description: '<p onclick="steal()">Description</p><script>alert(1)</script>',
    });
    expect(status).toBe(200);
    const fr = body.data.translations.fr;
    expect(fr.name).toEqual({ value: "Téléphone", outdated: false });
    expect(fr.description.value).toContain("Description");
    expect(fr.description.value).toBe("<p>Description</p>");
  });

  it("merge-patches: null removes a translation, an omitted field is untouched", async () => {
    await translate("/api/products/p-1/translations", "fr", { name: "Téléphone", description: "<p>D</p>" });
    const { body } = await translate("/api/products/p-1/translations", "fr", { description: null });
    expect(Object.keys(body.data.translations.fr)).toEqual(["name"]);
  });

  it("flags a translation outdated once its source changes, and only that field", async () => {
    await translate("/api/products/p-1/translations", "fr", { name: "Téléphone", description: "<p>D</p>" });
    await harness.db.update(schema.products).set({ name: "هاتف جديد" }).where(eq(schema.products.id, "p-1"));
    const { body } = await request("/api/products/p-1/translations");
    expect(body.data.translations.fr.name.outdated).toBe(true);
    expect(body.data.translations.fr.description.outdated).toBe(false);
    const rewritten = await translate("/api/products/p-1/translations", "fr", { name: "Nouveau téléphone" });
    expect(rewritten.body.data.translations.fr.name.outdated).toBe(false);
  });

  it("translates into an added language that is not published yet (a draft)", async () => {
    expect((await translate("/api/products/p-1/translations", "en", { name: "Phone" })).status).toBe(200);
  });

  it.each([
    ["the primary language", "ar", { name: "x" }],
    ["an unsupported language", "de", { name: "x" }],
    ["a field that is not translatable", "fr", { price: "1" }],
    ["an empty translation", "fr", { name: "  " }],
    ["an over-long translation", "fr", { name: "x".repeat(256) }],
    ["a non-string value", "fr", { name: 3 }],
  ])("refuses %s", async (_name, locale, values) => {
    expect((await translate("/api/products/p-1/translations", locale, values)).status).toBe(400);
    expect(await storedKeys("product")).toEqual([]);
  });

  it("refuses a language the store has not added", async () => {
    await harness.db.delete(schema.storeLocales).where(eq(schema.storeLocales.locale, "en"));
    expect((await translate("/api/products/p-1/translations", "en", { name: "Phone" })).status).toBe(400);
  });

  it("answers 404 for a resource that does not exist", async () => {
    expect((await request("/api/products/nope/translations")).status).toBe(404);
    expect((await translate("/api/offers/nope/translations", "fr", { name: "x" })).status).toBe(404);
  });

  it("guards translations with the resource's own scopes", async () => {
    user = { id: "staff", role: "staff", status: "active", scopes: ["products:read"] };
    expect((await request("/api/products/p-1/translations")).status).toBe(200);
    expect((await translate("/api/products/p-1/translations", "fr", { name: "x" })).status).toBe(403);
    expect((await request("/api/offers/o-1/translations")).status).toBe(403);
    expect((await request("/api/stores/me/translations")).status).toBe(403);
  });

  it("covers categories, offers and the store with the same rules", async () => {
    expect((await translate("/api/product-groups/cat-1/translations", "fr", { name: "Téléphones" })).status).toBe(200);
    expect((await translate("/api/offers/o-1/translations", "fr", { name: "2 achetés, 1 offert" })).status).toBe(200);
    expect((await translate("/api/stores/me/translations", "fr", { announcementBar: "Livraison gratuite" })).status).toBe(200);
    expect((await translate("/api/stores/me/translations", "fr", { name: "Mon magasin" })).status).toBe(400);
  });
});

describe("storefront reads in a language", () => {
  beforeEach(async () => {
    await translate("/api/products/p-1/translations", "fr", { name: "Téléphone", description: "<p>Un <b>bon</b> téléphone</p>" });
    await translate("/api/products/p-1/translations", "en", { name: "Phone (draft)" });
    await translate("/api/product-groups/cat-1/translations", "fr", { name: "Téléphones" });
    await translate("/api/offers/o-1/translations", "fr", { name: "2 achetés, 1 offert" });
    await translate("/api/stores/me/translations", "fr", { announcementBar: "Livraison gratuite" });
  });

  it("serves a published language, field by field, and says so", async () => {
    const { language, body } = await request("/store/products?locale=fr");
    expect(language).toBe("fr");
    const byId = Object.fromEntries(body.data.map((product: any) => [product.id, product]));
    expect(byId["p-1"].name).toBe("Téléphone");
    expect(byId["p-1"].descriptionFormat).toBe("html");
    expect(byId["p-1"].descriptionPlain).toBe("Un bon téléphone");
    expect(byId["p-2"].name).toBe("سماعات");
    expect(byId["p-1"].price).toBe(30000);
  });

  it("renders a translated description as HTML even when its source is legacy plain text", async () => {
    await translate("/api/products/p-2/translations", "fr", { description: "<p>Sans <b>fil</b></p>" });
    const { body } = await request("/store/products/buds?locale=fr");
    expect(body.data.description).toBe("<p>Sans <b>fil</b></p>");
    expect(body.data.descriptionFormat).toBe("html");
    expect(body.data.descriptionPlain).toBe("Sans fil");
    expect((await request("/store/products/buds")).body.data.descriptionFormat).toBe("text");
  });

  it("serves the primary for an unpublished, unknown or absent language — drafts never leak", async () => {
    for (const query of ["?locale=en", "?locale=de", "?locale=FR", ""]) {
      const { language, body } = await request(`/store/products${query}`);
      expect(language).toBe("ar");
      expect(body.data.map((product: any) => product.name).sort()).toEqual(["سماعات", "هاتف"]);
    }
    expect((await request(`/store/products?locale=${"x".repeat(36)}`)).status).toBe(400);
  });

  it("translates a product page: its category, its offers and their reward's name", async () => {
    await translate("/api/products/p-2/translations", "fr", { name: "Écouteurs" });
    const { language, body } = await request("/store/products/phone?locale=fr");
    expect(language).toBe("fr");
    expect(body.data.name).toBe("Téléphone");
    expect(body.data.category.name).toBe("Téléphones");
    expect(body.data.category.metaTitle).toBe("هواتف ذكية");
    expect(body.data.offers[0].name).toBe("2 achetés, 1 offert");
    expect(body.data.offers[0].rewardProductName).toBe("Écouteurs");
  });

  it("translates categories", async () => {
    const { language, body } = await request("/store/categories?locale=fr");
    expect(language).toBe("fr");
    expect(body.data[0].name).toBe("Téléphones");
  });

  it("serves the store's own text in the language, keeping untranslated fields", async () => {
    const { language, body } = await request("/store/config?locale=fr");
    expect(language).toBe("fr");
    expect(body.data.locale).toBe("fr");
    expect(body.data.lang).toBe("ar");
    expect(body.data.announcementBar).toBe("Livraison gratuite");
    expect(body.data.metaTitle).toBe("متجر الجزائر");
    expect((await request("/store/config?locale=en")).body.data.announcementBar).toBe("توصيل مجاني");
  });

  it("never lets a stray row overwrite a field that is not translatable", async () => {
    await harness.db.insert(schema.translations).values({
      resourceType: "product",
      resourceId: "p-1",
      locale: "fr",
      key: "handle",
      value: "hijacked",
      sourceDigest: "x",
      updatedAt: now(),
    });
    const { body } = await request("/store/products/phone?locale=fr");
    expect(body.data.handle).toBe("phone");
  });

  it("serves a legal page in the language, falling back to the primary", async () => {
    await harness.db.insert(schema.storePages).values({
      id: "page-1",
      storeId: STORE_ID,
      kind: "terms",
      slug: "terms",
      status: "published",
      createdAt: now(),
      updatedAt: now(),
    });
    const page = (locale: "ar" | "fr", title: string) => ({
      pageId: "page-1",
      locale,
      title,
      bodyHtml: "<p>x</p>",
      bodyPlain: "x",
      updatedAt: now(),
    });
    await harness.db.insert(schema.storePageTranslations).values([page("ar", "الشروط"), page("fr", "Conditions")]);
    expect((await request("/store/pages/terms?locale=fr")).body.data).toMatchObject({ locale: "fr", title: "Conditions" });
    expect((await request("/store/pages/terms?locale=en")).body.data).toMatchObject({ locale: "ar", title: "الشروط" });
    expect((await request("/store/pages/terms")).body.data).toMatchObject({ locale: "ar" });
  });
});

describe("translations leave with what they translate", () => {
  beforeEach(async () => {
    await translate("/api/products/p-1/translations", "fr", { name: "Téléphone" });
    await translate("/api/products/p-2/translations", "fr", { name: "Écouteurs" });
    await translate("/api/products/p-1/translations", "en", { name: "Phone" });
  });

  it("deleting a resource deletes its translations", async () => {
    await harness.db.delete(schema.offers);
    await harness.db.delete(schema.products).where(eq(schema.products.id, "p-1"));
    expect(await storedKeys("product")).toEqual(["p-2:fr:name"]);
  });

  it("removing a language from the store deletes its translations", async () => {
    const { status } = await request("/api/stores/me", {
      method: "PATCH",
      body: { languages: [{ locale: "ar", published: true }, { locale: "en", published: false }] },
    });
    expect(status).toBe(200);
    expect(await storedKeys("product")).toEqual(["p-1:en:name"]);
  });

  it("unpublishing a language keeps its translations", async () => {
    await request("/api/stores/me", {
      method: "PATCH",
      body: { languages: [{ locale: "ar", published: true }, { locale: "fr", published: false }, { locale: "en", published: false }] },
    });
    expect(await storedKeys("product")).toEqual(["p-1:en:name", "p-1:fr:name", "p-2:fr:name"]);
  });
});
