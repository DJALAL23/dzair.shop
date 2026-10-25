/**
 * A product's images through the real route stack onto real D1.
 *
 * Proved: an image added without a position goes after every image the
 * product has, whatever positions earlier removals left; a position below 1
 * is refused; an image is only added to a product that exists; removing an
 * image a variant shows leaves that variant without an image, never pointing
 * at a row that is gone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import productsRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-16T10:00:00.000Z";
const KEY = (n: string) => `products/${n.repeat(32)}.webp`;
const url = (key: string) => `https://media.example.com/${key}`;

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let deletedKeys: string[] = [];
const bucket = {
  delete: async (keys: string | string[]) => {
    deletedKeys.push(...(Array.isArray(keys) ? keys : [keys]));
  },
};

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, IMAGES: bucket } as never;
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
  deletedKeys = [];
  const db = d1.db;
  for (const table of [schema.productImages, schema.productVariants, schema.products]) {
    await db.delete(table);
  }
  await db.insert(schema.products).values({
    id: "p1", name: "Robe", handle: "robe", sku: "ROBE", price: 1500, inventory: 10, trackInventory: true, hasVariants: true, createdAt: T, updatedAt: T,
  });
  await db.insert(schema.productImages).values([
    { id: "i1", productId: "p1", src: url(KEY("a")), r2Key: KEY("a"), position: 1, createdAt: T, updatedAt: T },
    { id: "i2", productId: "p1", src: url(KEY("b")), r2Key: KEY("b"), position: 2, createdAt: T, updatedAt: T },
    { id: "i3", productId: "p1", src: url(KEY("c")), r2Key: KEY("c"), position: 3, createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.productVariants).values([
    { id: "v1", productId: "p1", variations: "{}", price: 1500, sku: "ROBE-M", inventory: 4, imageId: "i1", createdAt: T, updatedAt: T },
    { id: "v2", productId: "p1", variations: "{}", price: 1500, sku: "ROBE-L", inventory: 4, imageId: "i2", createdAt: T, updatedAt: T },
  ]);
});

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const listed = async () => ((await (await app.request("/api/products/p1/images")).json()) as { data: Array<{ id: string; src: string; position: number }> }).data;

describe("a product's images", () => {
  it("adds an image after the others when earlier ones were removed", async () => {
    expect((await app.request("/api/products/p1/images/i1", { method: "DELETE" })).status).toBe(200);
    expect((await app.request("/api/products/p1/images/i2", { method: "DELETE" })).status).toBe(200);

    const res = await app.request("/api/products/p1/images", json("POST", { key: KEY("d"), src: url(KEY("d")) }));

    expect(res.status).toBe(201);
    expect((await listed()).map((img) => img.src)).toEqual([url(KEY("c")), url(KEY("d"))]);
    expect(deletedKeys).toEqual([KEY("a"), KEY("b")]);
  });

  it("refuses a position below 1", async () => {
    const res = await app.request("/api/products/p1/images", json("POST", { key: KEY("d"), src: url(KEY("d")), position: 0 }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; context: { fields: Array<{ path: string }> } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.context.fields.map((field) => field.path)).toEqual(["position"]);
    expect(await listed()).toHaveLength(3);
  });

  it("adds an image only to a product that exists", async () => {
    const res = await app.request("/api/products/missing/images", json("POST", { key: KEY("d"), src: url(KEY("d")) }));

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
