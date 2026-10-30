/**
 * The images a store sets by key — a category's, the store's logo and share
 * image — through the real routes on real D1, their files in the store's
 * media (the R2 host on a real bucket).
 *
 * Proved: each is set only from a ready file and answered as a MediaImage at
 * the store's URL (the dashboard, /store/config, /store/categories); a URL or
 * a key not ready is refused and changes nothing; replacing, clearing or
 * deleting releases the file it showed, unless something else still shows it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { signIn } from "@/test-utils/sign-in";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_MEDIA_VARS, testMedia } from "@/test-utils/media";
import * as schema from "@/db/schema";
import { webp } from "../../../../cod-shared/media/hosts/testing/files";
import productGroupsRouter from "../product-groups/routes";
import storesRouter from "../stores/routes";
import storeRoutes from "../store/routes";

const T = "2026-10-20T08:00:00.000Z";
const KEY = (n: string) => `products/${n.repeat(32)}.webp`;
const image = (key: string) => ({ key, url: `${TEST_DELIVERY.origin}/${key}`, width: null, height: null });

let d1: TestD1;
let app: OpenAPIHono<AppContext>;

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const answer = async <T = any>(res: Response) => ({ status: res.status, body: (await res.json()) as T });
const held = async (key: string) => (await d1.bucket.head(key)) !== null && (await d1.db.select().from(schema.media).where(eq(schema.media.key, key)).get()) !== undefined;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS } as never;
    c.set("storeId", "s1");
    signIn(c, { id: "admin", email: "a@example.com", name: "Admin", role: "admin", status: "active", apiKey: "k", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/product-groups", productGroupsRouter);
  app.route("/api/stores", storesRouter);
  app.route("/store", storeRoutes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [schema.media, schema.products, schema.productCategories, schema.storeLocales, schema.stores]) await d1.db.delete(table);
  for (const n of ["a", "b", "c", "d", "e"]) await d1.bucket.delete(KEY(n));
  for (const n of ["a", "b", "c", "d"]) await testMedia(d1).store({ key: KEY(n), contentType: "image/webp", body: webp() });
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.storeLocales).values({ storeId: "s1", locale: "ar", published: true, createdAt: T });
});

describe("a category's image", () => {
  const create = (body: Record<string, unknown>) => app.request("/api/product-groups", json("POST", { name: "Robes", ...body }));
  const patch = (id: string, body: Record<string, unknown>) => app.request(`/api/product-groups/${id}`, json("PATCH", body));

  it("is set from a ready file and shown at the store's URL", async () => {
    const created = await answer(await create({ imageKey: KEY("a") }));
    expect(created.status).toBe(201);
    expect(created.body.data.image).toEqual(image(KEY("a")));
    expect(created.body.data).not.toHaveProperty("imageKey");
    expect(created.body.data).not.toHaveProperty("imageUrl");
    expect((await answer(await app.request("/store/categories"))).body.data[0].image).toEqual(image(KEY("a")));
  });

  it("is refused as a URL, or a key not ready, and nothing is created", async () => {
    expect(await answer(await create({ imageKey: `${TEST_DELIVERY.origin}/${KEY("a")}` }))).toMatchObject({ status: 400, body: { code: "VALIDATION_FAILED", context: { fields: [{ path: "imageKey" }] } } });
    expect(await answer(await create({ imageKey: KEY("e") }))).toMatchObject({ status: 409, body: { code: "MEDIA_NOT_READY" } });
    expect(await d1.db.select().from(schema.productCategories).all()).toEqual([]);
  });

  it("releases the file it showed when replaced, cleared or deleted", async () => {
    const { id } = (await answer(await create({ imageKey: KEY("a") }))).body.data;
    const replaced = await answer(await patch(id, { imageKey: KEY("b") }));
    expect(replaced).toMatchObject({ status: 200, body: { data: { image: image(KEY("b")) } } });
    expect([await held(KEY("a")), await held(KEY("b"))]).toEqual([false, true]);

    expect((await answer(await patch(id, { imageKey: null }))).body.data.image).toBeNull();
    expect(await held(KEY("b"))).toBe(false);

    await patch(id, { imageKey: KEY("c") });
    expect((await app.request(`/api/product-groups/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(await held(KEY("c"))).toBe(false);
  });

  it("keeps a released file that a product still shows", async () => {
    const { id } = (await answer(await create({ imageKey: KEY("a") }))).body.data;
    await d1.db.insert(schema.products).values({ id: "p1", name: "Robe", handle: "robe", price: 1, description: `<img src="media:${KEY("a")}">`, descriptionFormat: "html", createdAt: T, updatedAt: T });
    await app.request(`/api/product-groups/${id}`, { method: "DELETE" });
    expect(await held(KEY("a"))).toBe(true);
  });
});

describe("the store's logo and share image", () => {
  const update = (body: Record<string, unknown>) => app.request("/api/stores/me", json("PATCH", body));

  it("are set from ready files, and every storefront gets them from /store/config", async () => {
    const updated = await answer(await update({ logoKey: KEY("a"), ogImageKey: KEY("b") }));
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ logo: image(KEY("a")), ogImage: image(KEY("b")) });

    const config = (await answer(await app.request("/store/config"))).body.data;
    expect(config).toMatchObject({ logo: image(KEY("a")), ogImage: image(KEY("b")), media: TEST_DELIVERY });
  });

  it("are refused as a key not ready, and the store is left as it was", async () => {
    await update({ logoKey: KEY("a") });
    expect(await answer(await update({ logoKey: KEY("e"), name: "Autre" }))).toMatchObject({ status: 409, body: { code: "MEDIA_NOT_READY" } });
    expect(await d1.db.select({ name: schema.stores.name, logoKey: schema.stores.logoKey }).from(schema.stores).get()).toEqual({ name: "Boutique", logoKey: KEY("a") });
  });

  it("release the file they showed once replaced or cleared, but not one still shown", async () => {
    await update({ logoKey: KEY("a"), ogImageKey: KEY("b") });
    await update({ logoKey: KEY("c") });
    expect([await held(KEY("a")), await held(KEY("b")), await held(KEY("c"))]).toEqual([false, true, true]);

    await update({ ogImageKey: KEY("c") });
    expect(await held(KEY("b"))).toBe(false);
    await update({ logoKey: null });
    expect(await held(KEY("c"))).toBe(true);
    await update({ ogImageKey: null });
    expect(await held(KEY("c"))).toBe(false);
  });
});
