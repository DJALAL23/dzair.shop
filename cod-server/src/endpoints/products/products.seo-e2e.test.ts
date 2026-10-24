/**
 * A product's search-engine title and description on real D1, through the
 * real routers in the Workers runtime: a merchant writes them with the
 * product, clears them, translates them like any other text, and a storefront
 * reads them — translated, and null wherever none was written, so a theme
 * falls back to the product's own name and description.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";

const STORE_ID = "store-1";
const now = () => new Date().toISOString();

const WORKER = `
import { OpenAPIHono } from "@hono/zod-openapi";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import productsRouter from "./routes";
import storeRoutes from "../store/routes";

const app = new OpenAPIHono({ defaultHook: openApiValidationHook });
app.use("*", async (c, next) => {
  c.set("storeId", "${STORE_ID}");
  c.set("user", { id: "admin", role: "admin", status: "active", scopes: [] });
  await next();
});
app.onError(errorHandler);
app.route("/store", storeRoutes);
app.route("/api/products", productsRouter);
export default app;
`;

let harness: TestD1;

const request = async (path: string, init?: { method: string; body: unknown }) => {
  const res = await harness.fetch(`http://test${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  harness = await createTestD1({ worker: await bundleWorker(WORKER, __dirname) });
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  await harness.db.delete(schema.translations);
  await harness.db.delete(schema.products);
  await harness.db.delete(schema.storeLocales);
  await harness.db.delete(schema.stores);
  await harness.db.insert(schema.stores).values({ id: STORE_ID, name: "متجر", lang: "ar", createdAt: now(), updatedAt: now() });
  await harness.db.insert(schema.storeLocales).values([
    { storeId: STORE_ID, locale: "ar", published: true, createdAt: now() },
    { storeId: STORE_ID, locale: "fr", published: true, createdAt: now() },
  ]);
});

const create = (body: Record<string, unknown>) =>
  request("/api/products", { method: "POST", body: { name: "فستان", price: 2400, sku: `SKU-${crypto.randomUUID().slice(0, 6)}`, handle: "robe", ...body } });

describe("a product's search-engine title and description", () => {
  it("are written with the product, and a storefront reads them", async () => {
    const created = await create({ metaTitle: "فستان صيفي قطني", metaDescription: "فستان خفيف للصيف، توصيل لكل الولايات" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ metaTitle: "فستان صيفي قطني", metaDescription: "فستان خفيف للصيف، توصيل لكل الولايات" });

    const page = await request("/store/products/robe");
    expect(page.body.data).toMatchObject({ metaTitle: "فستان صيفي قطني", metaDescription: "فستان خفيف للصيف، توصيل لكل الولايات" });
    const list = await request("/store/products");
    expect(list.body.data[0]).toMatchObject({ metaTitle: "فستان صيفي قطني", metaDescription: "فستان خفيف للصيف، توصيل لكل الولايات" });
  });

  it("are null for a product that has none, so a theme falls back to its name and description", async () => {
    await create({});
    expect((await request("/store/products/robe")).body.data).toMatchObject({ metaTitle: null, metaDescription: null });
  });

  it("are cleared with an empty value, and trimmed", async () => {
    const { body } = await create({ metaTitle: "  عنوان  ", metaDescription: "وصف" });
    expect(body.data.metaTitle).toBe("عنوان");
    const cleared = await request(`/api/products/${body.data.id}`, { method: "PATCH", body: { metaTitle: "", metaDescription: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ metaTitle: null, metaDescription: null });
    const untouched = await request(`/api/products/${body.data.id}`, { method: "PATCH", body: { metaTitle: "جديد" } });
    expect(untouched.body.data).toMatchObject({ metaTitle: "جديد", metaDescription: null });
  });

  it("refuse text past what a search result shows", async () => {
    expect((await create({ metaTitle: "x".repeat(61) })).status).toBe(400);
    expect((await create({ metaDescription: "x".repeat(161) })).status).toBe(400);
    expect((await create({ metaTitle: "x".repeat(60), metaDescription: "x".repeat(160) })).status).toBe(201);
  });

  it("are translated like any other text, and a storefront reads them in its language", async () => {
    const { body } = await create({ metaTitle: "فستان صيفي", metaDescription: "وصف بالعربية" });
    const translated = await request(`/api/products/${body.data.id}/translations`, { method: "PATCH", body: { locale: "fr", values: { metaTitle: "Robe d'été", metaDescription: "Description en français" } } });
    expect(translated.status).toBe(200);
    expect(translated.body.data.translations.fr).toMatchObject({ metaTitle: { value: "Robe d'été" }, metaDescription: { value: "Description en français" } });

    expect((await request("/store/products/robe?locale=fr")).body.data).toMatchObject({ metaTitle: "Robe d'été", metaDescription: "Description en français" });
    expect((await request("/store/products?locale=fr")).body.data[0]).toMatchObject({ metaTitle: "Robe d'été" });
    expect((await request("/store/products/robe")).body.data).toMatchObject({ metaTitle: "فستان صيفي", metaDescription: "وصف بالعربية" });
  });

  it("refuse a translation past the same lengths", async () => {
    const { body } = await create({});
    const refused = await request(`/api/products/${body.data.id}/translations`, { method: "PATCH", body: { locale: "fr", values: { metaTitle: "x".repeat(61) } } });
    expect(refused.status).toBe(400);
  });
});
