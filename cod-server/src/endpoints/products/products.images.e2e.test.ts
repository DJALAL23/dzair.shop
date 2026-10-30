/**
 * A product's images through the real route stack onto real D1, its files in
 * the store's media (the R2 host on a real bucket).
 *
 * Proved: an image is attached by the key of a ready file, never a URL or a
 * key the store does not hold, and takes the file's size; one added without
 * a position goes after every image the product has, whatever positions
 * earlier removals left; a position below 1 is refused; an image is only
 * added to a product that exists; removing an image deletes its file unless
 * something else still shows it; removing an image a variant shows leaves
 * that variant without an image, never pointing at a row that is gone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_MEDIA_VARS, testMedia } from "@/test-utils/media";
import { webp } from "../../../../cod-shared/media/hosts/testing/files";
import * as schema from "@/db/schema";
import productsRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-16T10:00:00.000Z";
const KEY = (n: string) => `products/${n.repeat(32)}.webp`;
const url = (key: string) => `${TEST_DELIVERY.origin}/${key}`;

let d1: TestD1;
let app: OpenAPIHono<AppContext>;

const held = async (key: string) => (await d1.bucket.head(key)) !== null;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes: ["products:read", "products:manage"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/products", productsRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  const db = d1.db;
  for (const table of [schema.media, schema.productImages, schema.productVariants, schema.products]) {
    await db.delete(table);
  }
  for (const n of ["a", "b", "c", "d"]) await d1.bucket.delete(KEY(n));
  for (const n of ["a", "b", "c"]) await testMedia(d1).store({ key: KEY(n), contentType: "image/webp", body: webp() });
  await testMedia(d1).store({ key: KEY("d"), contentType: "image/webp", body: webp(), width: 1200, height: 900 });
  await db.insert(schema.products).values({
    id: "p1", name: "Robe", handle: "robe", sku: "ROBE", price: 1500, inventory: 10, trackInventory: true, hasVariants: true, createdAt: T, updatedAt: T,
  });
  await db.insert(schema.productImages).values([
    { id: "i1", productId: "p1", mediaKey: KEY("a"), position: 1, createdAt: T, updatedAt: T },
    { id: "i2", productId: "p1", mediaKey: KEY("b"), position: 2, createdAt: T, updatedAt: T },
    { id: "i3", productId: "p1", mediaKey: KEY("c"), position: 3, createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.productVariants).values([
    { id: "v1", productId: "p1", variations: "{}", price: 1500, sku: "ROBE-M", inventory: 4, imageId: "i1", createdAt: T, updatedAt: T },
    { id: "v2", productId: "p1", variations: "{}", price: 1500, sku: "ROBE-L", inventory: 4, imageId: "i2", createdAt: T, updatedAt: T },
  ]);
});

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const listed = async () => ((await (await app.request("/api/products/p1/images")).json()) as { data: Array<{ id: string; key: string; url: string; width: number | null; height: number | null; position: number }> }).data;

describe("a product's images", () => {
  it("adds an image after the others when earlier ones were removed", async () => {
    expect((await app.request("/api/products/p1/images/i1", { method: "DELETE" })).status).toBe(200);
    expect((await app.request("/api/products/p1/images/i2", { method: "DELETE" })).status).toBe(200);

    const res = await app.request("/api/products/p1/images", json("POST", { mediaKey: KEY("d") }));

    expect(res.status).toBe(201);
    expect((await listed()).map((img) => img.url)).toEqual([url(KEY("c")), url(KEY("d"))]);
    expect([await held(KEY("a")), await held(KEY("b")), await held(KEY("c"))]).toEqual([false, false, true]);
  });

  it("attaches a ready file by its key, with the file's size", async () => {
    const res = await app.request("/api/products/p1/images", json("POST", { mediaKey: KEY("d"), altText: "Robe d'été" }));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: unknown }).data).toMatchObject({ key: KEY("d"), url: url(KEY("d")), width: 1200, height: 900, altText: "Robe d'été", position: 4 });
    expect(await d1.db.select({ src: schema.productImages.src }).from(schema.productImages).where(eq(schema.productImages.mediaKey, KEY("d"))).all()).toEqual([{ src: null }]);
  });

  it("refuses a URL, and a key the store's media does not hold ready", async () => {
    const asUrl = await app.request("/api/products/p1/images", json("POST", { mediaKey: url(KEY("d")) }));
    expect(asUrl.status).toBe(400);
    expect(((await asUrl.json()) as { code: string; context: { fields: Array<{ path: string }> } })).toMatchObject({ code: "VALIDATION_FAILED", context: { fields: [{ path: "mediaKey" }] } });
    const missing = await app.request("/api/products/p1/images", json("POST", { mediaKey: KEY("e") }));
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { code: string }).code).toBe("MEDIA_NOT_READY");
    expect(await listed()).toHaveLength(3);
  });

  it("keeps a removed image's file while the description still shows it", async () => {
    await d1.db.update(schema.products).set({ description: `<img src="media:${KEY("a")}">`, descriptionFormat: "html" }).where(eq(schema.products.id, "p1"));
    expect((await app.request("/api/products/p1/images/i1", { method: "DELETE" })).status).toBe(200);
    expect(await held(KEY("a"))).toBe(true);
  });

  it("refuses a position below 1", async () => {
    const res = await app.request("/api/products/p1/images", json("POST", { mediaKey: KEY("d"), position: 0 }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; context: { fields: Array<{ path: string }> } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.context.fields.map((field) => field.path)).toEqual(["position"]);
    expect(await listed()).toHaveLength(3);
  });

  it("adds an image only to a product that exists", async () => {
    const res = await app.request("/api/products/missing/images", json("POST", { mediaKey: KEY("d") }));

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("PRODUCT_NOT_FOUND");
    expect(await d1.db.select().from(schema.productImages).where(eq(schema.productImages.productId, "missing")).all()).toEqual([]);
  });

  it("leaves a variant without an image when the image it shows is removed", async () => {
    expect((await app.request("/api/products/p1/images/i1", { method: "DELETE" })).status).toBe(200);

    const variants = await d1.db.select({ id: schema.productVariants.id, imageId: schema.productVariants.imageId }).from(schema.productVariants).orderBy(schema.productVariants.id).all();
    expect(variants).toEqual([{ id: "v1", imageId: null }, { id: "v2", imageId: "i2" }]);
  });

  it("sets the order it is sent, numbering from 1", async () => {
    const res = await app.request("/api/products/p1/images/reorder", json("PATCH", { imageIds: ["i3", "i1", "i2"] }));

    expect(res.status).toBe(200);
    expect((await listed()).map((img) => [img.id, img.position])).toEqual([["i3", 1], ["i1", 2], ["i2", 3]]);
  });
});
