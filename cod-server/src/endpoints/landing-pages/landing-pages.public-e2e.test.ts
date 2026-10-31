/**
 * Landing Pages — Slice 4: public store endpoint on real D1.
 *
 * The real store router + real error handler + real store-auth middleware
 * against real migrations. Covers the public contract: published resolves
 * with the full store-product shape, draft/archived/unknown 404 identically,
 * and every render increments views atomically (proven with concurrent GETs).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { storeAuthMiddleware } from "@/middleware/storeAuth";
import storeRouter from "../store/routes";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { TEST_MEDIA_VARS, TEST_DELIVERY } from "@/test-utils/media";

let db: AppDb;
let rawD1: D1Database;
let app: OpenAPIHono<AppContext>;
const STORE_KEY = "store-key-lp-test";

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  rawD1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const prepared: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) prepared.push(rawD1.prepare(statement));
  }
  for (let i = 0; i < prepared.length; i += 50) {
    await rawD1.batch(prepared.slice(i, i + 50));
  }
  db = drizzle(rawD1 as unknown as D1Database, { schema }) as unknown as AppDb;

  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: rawD1 as any, ...TEST_MEDIA_VARS } as any;
    await next();
  });
  app.use("/store/*", storeAuthMiddleware);
  app.onError(errorHandler);
  app.route("/store", storeRouter);

  registry.push(mf);
}, 120_000);

const registry: Miniflare[] = [];
afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

const NOW = () => new Date().toISOString();
let seq = 0;

const STORE_HEADERS = { "X-Store-API-Key": STORE_KEY };

/**
 * GET with an executionCtx stub so the handler's waitUntil (deferred view
 * increments) works under app.request — then settle the deferred writes
 * before returning. Pattern from store/otp-gate.test.ts.
 */
async function getAndSettle(path: string): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
    props: {} as Record<string, unknown>,
  };
  const res = await app.request(path, { headers: STORE_HEADERS }, undefined, executionCtx);
  await Promise.allSettled(pending);
  return res;
}

async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedStore(): Promise<string> {
  await db.insert(schema.stores).values({
    id: "store-lp-1", name: "LP Test Store", lang: "ar", currency: "DZD",
    currencySymbol: "دج", createdAt: NOW(), updatedAt: NOW(),
  });
  await db.insert(schema.storeApiKeys).values({
    id: "sak-lp-1", storeId: "store-lp-1",
    keyHash: await sha256hex(STORE_KEY), name: "test",
    createdAt: NOW(),
  });
  return "store-lp-1";
}

async function seedProduct(): Promise<{ id: string; handle: string }> {
  const id = `prod-lps-${++seq}`;
  const handle = `lps-product-${seq}`;
  await db.insert(schema.products).values({
    id, name: `LPS Product ${seq}`, handle, price: 5000,
    hasVariants: false, inventory: 10, trackInventory: true, lowStockThreshold: 2,
    status: "ACTIVE", visibility: true, showInStore: true,    createdAt: NOW(), updatedAt: NOW(),
  });
  return { id, handle };
}

async function seedPublishedLp(slug: string, productId: string) {
  const now = NOW();
  await db.insert(schema.landingPages).values({
    id: slug, slug, name: `LP ${slug}`, productId, status: "published",
    publishedAt: now, createdAt: now, updatedAt: now,
  });
  for (let i = 1; i <= 3; i++) {
    await db.insert(schema.landingPageImages).values({
      id: `${slug}-img-${i}`, landingPageId: slug,
      mediaKey: `landing/${slug}-${i}.jpg`,
      altText: `صورة ${i}`, source: "upload", position: i, createdAt: now,
    });
  }
}

describe("Slice 4 — public GET /store/landing-pages/{slug} (real D1 + store auth)", () => {
  beforeAll(async () => {
    await seedStore();
  });

  it("published LP resolves with the ordered stack and the full product shape", async () => {
    const { id, handle } = await seedProduct();
    await seedPublishedLp("live-page", id);

    const res = await getAndSettle("/store/landing-pages/live-page");
    expect(res.status).toBe(200);
    const body: any = await res.json();

    expect(body.data).toMatchObject({
      slug: "live-page", status: "published", imageGap: 0,
    });
    expect(body.data.images).toHaveLength(3);
    expect(body.data.images[0]).toMatchObject({ position: 1, altText: "صورة 1" });
    expect(body.data.images.map((i: any) => [i.key, i.url])).toEqual(
      [1, 2, 3].map((n) => [`landing/live-page-${n}.jpg`, `${TEST_DELIVERY.origin}/landing/live-page-${n}.jpg`]),
    );
    expect(body.data.images[0]).not.toHaveProperty("src");

    // The product arrives in the exact store-product shape the product page
    // consumes — variants/offers/inventory included.
    expect(body.data.product).toMatchObject({
      id, handle, price: 5000, inventory: 10,
    });
    expect(Array.isArray(body.data.product.offers)).toBe(true);
  });

  it("draft, archived, and unknown slugs all 404 identically — nothing leaks", async () => {
    const { id } = await seedProduct();
    const now = NOW();
    await db.insert(schema.landingPages).values({
      id: "draft-page", slug: "draft-page", name: "Draft", productId: id,
      status: "draft", createdAt: now, updatedAt: now,
    });
    await db.insert(schema.landingPages).values({
      id: "archived-page", slug: "archived-page", name: "Archived", productId: id,
      status: "archived", createdAt: now, updatedAt: now,
    });

    for (const slug of ["draft-page", "archived-page", "never-existed"]) {
      const res = await getAndSettle(`/store/landing-pages/${slug}`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as any).code).toBe("LANDING_PAGE_NOT_FOUND");
    }
  });

  it("every GET increments views — 25 concurrent GETs count exactly 25", async () => {
    const { id } = await seedProduct();
    await seedPublishedLp("counted-page", id);

    // The view increment is deferred via waitUntil (docs: analytics writes
    // never block the response) — getAndSettle settles every deferred write
    // before the response is returned to the test.
    await Promise.all(
      Array.from({ length: 25 }, () => getAndSettle("/store/landing-pages/counted-page")),
    );

    const row = await db.select().from(schema.landingPages)
      .where(eq(schema.landingPages.slug, "counted-page")).get();
    expect(row?.views).toBe(25);
  });

  it("missing store key is rejected before anything renders", async () => {
    const res = await app.request("/store/landing-pages/live-page");
    expect(res.status).toBe(401);
  });
});

describe("a landing page's own document, its language and an editor's preview", () => {
  const document = (id: string) => ({ version: 1, surface: `lp:${id}`, sections: [{ id: "order", type: "landing-order" }], hiddenAreas: ["header"] });

  it("answers the page's own document for the theme that asks, and none otherwise", async () => {
    const { id } = await seedProduct();
    await seedPublishedLp("with-layout", id);
    await db.insert(schema.pageDocuments).values({
      id: "pd-with-layout", storeId: "store-lp-1", themeKey: "theme-00", surface: "lp:with-layout",
      document: JSON.stringify(document("with-layout")), createdAt: NOW(), updatedAt: NOW(),
    });
    const read = async (query: string) => ((await (await getAndSettle(`/store/landing-pages/with-layout${query}`)).json()) as any).data.document;
    expect(await read("?theme=theme-00")).toEqual(document("with-layout"));
    expect(await read("?theme=theme-baby")).toBeNull();
    expect(await read("")).toBeNull();
  });

  it("serves the page's product in the shopper's language", async () => {
    const { id } = await seedProduct();
    await seedPublishedLp("in-french", id);
    await db.insert(schema.storeLocales).values([
      { storeId: "store-lp-1", locale: "ar", published: true, createdAt: NOW() },
      { storeId: "store-lp-1", locale: "fr", published: true, createdAt: NOW() },
    ]);
    await db.insert(schema.translations).values({ resourceType: "product", resourceId: id, locale: "fr", key: "name", value: "Robe en coton", sourceDigest: "d", updatedAt: NOW() });
    const name = async (query: string) => ((await (await getAndSettle(`/store/landing-pages/in-french${query}`)).json()) as any).data.product.name;
    expect(await name("?locale=fr")).toBe("Robe en coton");
    expect(await name("")).toMatch(/^LPS Product /);
  });

  it("shows an editor a draft page and counts no visit, while a shopper sees neither", async () => {
    const { id } = await seedProduct();
    await db.insert(schema.landingPages).values({
      id: "being-designed", slug: "being-designed", name: "Draft", productId: id, status: "draft", createdAt: NOW(), updatedAt: NOW(),
    });
    expect((await getAndSettle("/store/landing-pages/being-designed")).status).toBe(404);
    expect((await getAndSettle("/store/landing-pages/being-designed?preview=1")).status).toBe(200);
    await seedPublishedLp("popular", id);
    await getAndSettle("/store/landing-pages/popular?preview=1");
    await getAndSettle("/store/landing-pages/popular");
    const views = async (slug: string) => (await db.select({ views: schema.landingPages.views }).from(schema.landingPages).where(eq(schema.landingPages.id, slug)).get())?.views;
    expect(await views("being-designed")).toBe(0);
    expect(await views("popular")).toBe(1);
  });

  it("keeps an archived page out of a preview too", async () => {
    const { id } = await seedProduct();
    await db.insert(schema.landingPages).values({
      id: "retired", slug: "retired", name: "Retired", productId: id, status: "archived", createdAt: NOW(), updatedAt: NOW(),
    });
    expect((await getAndSettle("/store/landing-pages/retired?preview=1")).status).toBe(404);
  });
});
