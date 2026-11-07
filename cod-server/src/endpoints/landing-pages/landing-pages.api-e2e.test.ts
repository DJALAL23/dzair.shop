/**
 * Landing Pages — Slice 2: management API on real D1 + real route stack.
 *
 * The real OpenAPIHono router + real error handler + real queries against
 * real migrations. Auth middleware is stubbed with an admin user (the
 * dashboard seam) — the RBAC middleware itself is covered by route tests.
 *
 * Covers: create (draft, slug default, 409 on taken slug, 404 on missing
 * product), update (slug change + 409), publish/unpublish/archive lifecycle,
 * delete guard (refused with orders, clean without), reorder validation,
 * no analytics on the page itself.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { eq } from "drizzle-orm";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_MEDIA_VARS, testMedia } from "@/test-utils/media";
import { webp } from "../../../../cod-shared/media/hosts/testing/files";
import landingPagesRouter from "./routes";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";

let d1: TestD1;
let db: AppDb;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  db = d1.db;

  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS } as never;
    signIn(c, {
      id: "admin_user_001",
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
      status: "active",
      apiKey: "cod_admin_key",
      scopes: ["*"],
    } as any);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/landing-pages", landingPagesRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

/** Puts a file in the store's media and attaches it to the landing page by its key. */
async function addImage(landingPageId: string, key: string, extra: Record<string, unknown> = {}): Promise<Response> {
  await testMedia(d1).store({ key, contentType: "image/webp", body: webp() });
  return app.request(`/api/landing-pages/${landingPageId}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaKey: key, ...extra }),
  });
}

const held = async (key: string) => (await d1.bucket.head(key)) !== null;

const NOW = () => new Date().toISOString();
let seq = 0;

async function seedProduct(): Promise<string> {
  const id = `prod-lpm-${++seq}`;
  await db.insert(schema.products).values({
    id, name: `LPM Product ${seq}`, handle: `lpm-product-${seq}`, price: 5000,
    hasVariants: false, inventory: 10, trackInventory: true, lowStockThreshold: 2,
    status: "ACTIVE", visibility: true, showInStore: true,    createdAt: NOW(), updatedAt: NOW(),
  });
  return id;
}

async function seedCustomer(): Promise<string> {
  const id = `cust-lpm-${++seq}`;
  await db.insert(schema.customers).values({
    id, name: "LPM Customer", phone: `0555${String(300000 + seq).slice(-6)}`,
    wilaya: "الجزائر", createdAt: NOW(),
  });
  return id;
}

async function createLp(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/landing-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Slice 2 — landing pages management API (real D1 + real routes)", () => {
  it("creates a draft LP with an auto-generated slug and default spacing", async () => {
    const productId = await seedProduct();
    const res = await createLp({ name: "Zinc v1 — test", productId });
    expect(res.status).toBe(201);
    const body: any = (await res.json()) as any;
    expect(body.data).toMatchObject({
      name: "Zinc v1 — test",
      productId,
      status: "draft",
      imageGap: 0,
      sidePadding: 0,
      contentMaxWidth: 0,
      publishedAt: null,
    });
    expect(body.data.slug).toMatch(/^lp-[a-z0-9]{8}$/);
    expect(body.data.product.name).toBe(`LPM Product ${seq}`);
    expect(body.data.images).toEqual([]);
    expect(body.data).not.toHaveProperty("views");
    expect(body.data).not.toHaveProperty("stats");
  });

  it("refuses creation for a missing product (404) — no orphan LP", async () => {
    const res = await createLp({ name: "Orphan", productId: "prod-does-not-exist" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe("PRODUCT_NOT_FOUND");
  });

  it("slug collision returns a friendly 409, never a raw 500", async () => {
    const productId = await seedProduct();
    const slugBase = `my-lp-${crypto.randomUUID().slice(0, 6)}`;
    const first = await createLp({ name: "First", productId, slug: slugBase });
    expect(first.status).toBe(201);

    const dup = await createLp({ name: "Second", productId, slug: slugBase });
    expect(dup.status).toBe(409);
    const body: any = (await dup.json()) as any;
    expect(body.code).toBe("DUPLICATE_ENTITY");
    expect(body.context).toMatchObject({ slug: slugBase });
  });

  it("updates spacing + slug; renaming to a taken slug is a 409", async () => {
    const productId = await seedProduct();
    const rnd = crypto.randomUUID().slice(0, 6);
    const created = (await (await createLp({ name: "Original", productId, slug: `orig-${rnd}` })).json()) as any;
    const other = (await (await createLp({ name: "Other", productId, slug: `other-${rnd}` })).json()) as any;

    const ok = await app.request(`/api/landing-pages/${created.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageGap: 12, name: "Renamed" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data).toMatchObject({
      imageGap: 12, name: "Renamed",
    });

    const clash = await app.request(`/api/landing-pages/${created.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: `other-${rnd}` }),
    });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as any).context).toMatchObject({ slug: `other-${rnd}` });
  });

  it("publish → live; unpublish → draft; archive → archived", async () => {
    const productId = await seedProduct();
    const created = (await (await createLp({ name: "Lifecycle", productId })).json()) as any;
    const id = created.data.id;

    const pub = await app.request(`/api/landing-pages/${id}/publish`, { method: "POST" });
    expect(pub.status).toBe(200);
    const pubBody: any = (await pub.json()) as any;
    expect(pubBody.data).toMatchObject({ status: "published" });
    expect(pubBody.data.publishedAt).toBeTruthy();

    const unpub = await app.request(`/api/landing-pages/${id}/unpublish`, { method: "POST" });
    const unpubBody: any = (await unpub.json()) as any;
    expect(unpubBody.data).toMatchObject({ status: "draft" });
    expect(unpubBody.data.publishedAt).toBeTruthy(); // history preserved

    const arch = await app.request(`/api/landing-pages/${id}/archive`, { method: "POST" });
    expect(arch.status).toBe(200);
    const row = await db.select().from(schema.landingPages)
      .where(eq(schema.landingPages.id, id)).get();
    expect(row?.status).toBe("archived");
  });

  it("images: add → ordered stack; reorder; foreign/duplicate IDs rejected", async () => {
    const productId = await seedProduct();
    const created = (await (await createLp({ name: "Images LP", productId })).json()) as any;
    const id = created.data.id;

    const add1 = await addImage(id, "landing/img-1.jpg", { altText: "الأول" });
    expect(add1.status).toBe(201);
    expect(((await add1.json()) as any).data).toHaveLength(1);

    await addImage(id, "landing/img-2.jpg");
    await addImage(id, "landing/img-3.jpg");

    const list = (await (await app.request(`/api/landing-pages/${id}/images`)).json()) as any;
    expect(list.data.map((i: any) => i.position)).toEqual([1, 2, 3]);

    // A position takes that place; the images from there move down one
    const placed = await addImage(id, "landing/img-top.jpg", { position: 2 });
    expect((((await placed.json()) as any).data as any[]).map((i) => [i.key, i.position])).toEqual([
      ["landing/img-1.jpg", 1], ["landing/img-top.jpg", 2], ["landing/img-2.jpg", 3], ["landing/img-3.jpg", 4],
    ]);
    const placedId = (await db.select().from(schema.landingPageImages).where(eq(schema.landingPageImages.mediaKey, "landing/img-top.jpg")).get())!.id;
    await app.request(`/api/landing-pages/${id}/images/${placedId}`, { method: "DELETE" });
    const imgIds = list.data.map((i: any) => i.id);

    // Reorder 3,1,2
    const reorder = await app.request(`/api/landing-pages/${id}/images/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds: [imgIds[2], imgIds[0], imgIds[1]] }),
    });
    const reordered: any[] = ((await reorder.json()) as any).data;
    expect(reordered[0].key).toBe("landing/img-3.jpg");
    expect(reordered.map((i: any) => i.position)).toEqual([1, 2, 3]);

    // Duplicate IDs rejected (ValidationError → 400, same taxonomy as products reorder)
    const dup = await app.request(`/api/landing-pages/${id}/images/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds: [imgIds[0], imgIds[0], imgIds[1]] }),
    });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as any).code).toBe("VALIDATION_FAILED");

    // Foreign ID rejected
    const foreign = await app.request(`/api/landing-pages/${id}/images/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds: [imgIds[0], imgIds[1], "img-not-ours"] }),
    });
    expect(foreign.status).toBe(400);
  });

  it("delete refused while orders exist (422 LANDING_PAGE_HAS_ORDERS); clean delete works", async () => {
    const productId = await seedProduct();
    const withOrders = (await (await createLp({ name: "Guarded", productId, slug: `guarded-${crypto.randomUUID().slice(0, 6)}` })).json()) as any;
    const cust = await seedCustomer();
    await db.insert(schema.orders).values({
      id: "ord-guard-1", orderNumber: "ORD-GUARD-1", customerId: cust,
      customerName: "Guard", phone: "0555000003", price: 5000,
      status: "new", deliveryType: "home",
      deliveryFee: 0, codAmount: 5000, landingPageId: withOrders.data.id,
      createdAt: NOW(), updatedAt: NOW(),
    });

    const refused = await app.request(`/api/landing-pages/${withOrders.data.id}`, { method: "DELETE" });
    expect(refused.status).toBe(422);
    const body: any = await refused.json();
    expect(body.code).toBe("LANDING_PAGE_HAS_ORDERS");
    expect(body.context).toMatchObject({ orderCount: 1 });

    // Clean LP deletes, images cascade
    const clean = (await (await createLp({ name: "Clean", productId, slug: `clean-${crypto.randomUUID().slice(0, 6)}` })).json()) as any;
    await addImage(clean.data.id, "landing/clean-1.jpg");
    const del = await app.request(`/api/landing-pages/${clean.data.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const images = await db.select().from(schema.landingPageImages)
      .where(eq(schema.landingPageImages.landingPageId, clean.data.id));
    expect(images).toHaveLength(0);
  });

  it("list: filter by product returns its LPs, with no analytics", async () => {
    const productId = await seedProduct();
    const rnd = crypto.randomUUID().slice(0, 6);
    const slugA = `cmp-a-${rnd}`;
    const slugB = `cmp-b-${rnd}`;
    const a = (await (await createLp({ name: "Creative A", productId, slug: slugA })).json()) as any;
    const b = (await (await createLp({ name: "Creative B", productId, slug: slugB })).json()) as any;
    await createLp({ name: "Other product LP", productId: await seedProduct(), slug: `cmp-x-${crypto.randomUUID().slice(0, 6)}` });

    const list = (await (await app.request(`/api/landing-pages?productId=${productId}`)).json()) as any;
    expect(list.data.map((d: any) => d.id).sort()).toEqual([a.data.id, b.data.id].sort());
    expect(list.data[0]).toMatchObject({ productName: expect.any(String), imageCount: expect.any(Number) });
    for (const field of ["views", "orders", "revenue"]) expect(list.data[0]).not.toHaveProperty(field);
    expect(list.data.map((d: any) => d.slug).sort()).toEqual([slugA, slugB].sort());

    const compare = await app.request(`/api/landing-pages/compare?productId=${productId}`);
    expect(compare.status).not.toBe(200);
  });

  it("list pagination: opt-in limit/offset; omitted → full list", async () => {
    const productId = await seedProduct();
    const rnd = crypto.randomUUID().slice(0, 6);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = (await (
        await createLp({ name: `Page ${i}`, productId, slug: `pg-${i}-${rnd}` })
      ).json()) as any;
      ids.push(res.data.id);
    }

    // No params → unbounded (dashboard contract).
    const full = (await (
      await app.request(`/api/landing-pages?productId=${productId}`)
    ).json()) as any;
    expect(full.data).toHaveLength(3);

    // limit=2 → exactly 2 rows of this product.
    const page1 = (await (
      await app.request(`/api/landing-pages?productId=${productId}&limit=2`)
    ).json()) as any;
    expect(page1.data).toHaveLength(2);
    expect(page1.count).toBe(2);
    page1.data.forEach((row: any) => expect(row.productId).toBe(productId));

    // limit=2&offset=2 → exactly 1 row.
    const page2 = (await (
      await app.request(`/api/landing-pages?productId=${productId}&limit=2&offset=2`)
    ).json()) as any;
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].productId).toBe(productId);

    // Pages cover the full set without overlap.
    const paged = new Set([...page1.data, ...page2.data].map((d: any) => d.id));
    expect([...paged].sort()).toEqual([...ids].sort());

    // Out-of-range limit is a 400 validation error.
    const bad = await app.request(`/api/landing-pages?limit=500`);
    expect(bad.status).toBe(400);
  });

  it("getLandingPageById detail carries images + product together (batched read)", async () => {
    const productId = await seedProduct();
    const rnd = crypto.randomUUID().slice(0, 6);
    const created = (await (
      await createLp({ name: "Detail page", productId, slug: `detail-${rnd}` })
    ).json()) as any;

    const detail = (await (
      await app.request(`/api/landing-pages/${created.data.id}`)
    ).json()) as any;
    expect(detail.data.id).toBe(created.data.id);
    expect(Array.isArray(detail.data.images)).toBe(true);
    expect(detail.data.product).toMatchObject({ id: productId, price: expect.any(Number) });
  });

  it("invalid slug format is a 400 validation error (not a 500)", async () => {
    const productId = await seedProduct();
    const res = await createLp({ name: "Bad slug", productId, slug: "Invalid Slug!" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("VALIDATION_FAILED");
  });
});

describe("publicUrl resolution — store domain wins, env falls back, relative last", () => {
  it("no domain, no fallback env → relative /lp/<slug>", async () => {
    const productId = await seedProduct();
    const res = await createLp({ name: "Relative URL", productId, slug: "url-relative-" + crypto.randomUUID().slice(0, 6) });
    const body: any = await res.json();
    expect(body.data.publicUrl).toBe(`/lp/${body.data.slug}`);
  });

  it("store domain set → https://<domain>/lp/<slug>", async () => {
    const productId = await seedProduct();
    await db.insert(schema.stores).values({
      id: "store-url-test", name: "URL Store", lang: "ar", currency: "DZD",
      currencySymbol: "دج", domain: "demo.codflow.store",
      createdAt: NOW(), updatedAt: NOW(),
    }).onConflictDoUpdate({
      target: schema.stores.id,
      set: { domain: "demo.codflow.store" },
    });

    const res = await createLp({ name: "Domain URL", productId, slug: "url-domain-" + crypto.randomUUID().slice(0, 6) });
    const body: any = await res.json();
    expect(body.data.publicUrl).toBe(`https://demo.codflow.store/lp/${body.data.slug}`);

    // list carries it too
    const list: any = await (await app.request("/api/landing-pages")).json();
    const mine = list.data.find((d: any) => d.id === body.data.id);
    expect(mine.publicUrl).toBe(`https://demo.codflow.store/lp/${mine.slug}`);

    // cleanup the domain so later tests aren't affected
    await db.update(schema.stores).set({ domain: null }).where(eq(schema.stores.id, "store-url-test"));
  });
});

describe("duplicate + shared file guard", () => {
  it("duplicate: fresh draft, new slug, no attributed orders, images share their files", async () => {
    const productId = await seedProduct();
    const created: any = await (await createLp({ name: "Original Creative", productId, slug: `dup-src-${crypto.randomUUID().slice(0, 6)}` })).json();
    const sourceId = created.data.id;

    // Two images on the source
    await addImage(sourceId, `landing/dup-${crypto.randomUUID().slice(0, 6)}.jpg`);
    await addImage(sourceId, `landing/dup2-${crypto.randomUUID().slice(0, 6)}.jpg`);
    // An attributed order on the source — must NOT move to the copy
    const cust = await seedCustomer();
    await db.insert(schema.orders).values({
      id: `ord-dup-${crypto.randomUUID().slice(0, 6)}`, orderNumber: `ORD-DUP-${crypto.randomUUID().slice(0, 6)}`,
      customerId: cust, customerName: "Dup", phone: "0555000009", price: 5000,
      status: "new", deliveryType: "home",
      deliveryFee: 0, codAmount: 5000, landingPageId: sourceId,
      createdAt: NOW(), updatedAt: NOW(),
    });

    const dupRes = await app.request(`/api/landing-pages/${sourceId}/duplicate`, { method: "POST" });
    expect(dupRes.status).toBe(201);
    const dup: any = await dupRes.json();
    expect(dup.data).toMatchObject({
      status: "draft",
      name: "Original Creative (copy)",
      productId,
    });
    expect(dup.data.slug).toMatch(/^lp-[a-z0-9]{8}$/);
    expect(dup.data.slug).not.toBe("dup-src"); // never the source slug
    expect(dup.data.images).toHaveLength(2);

    // Images show the SAME files (immutable, shared)
    const sourceImages = await db.select().from(schema.landingPageImages)
      .where(eq(schema.landingPageImages.landingPageId, sourceId));
    const dupImages = dup.data.images as Array<{ key: string }>;
    expect(dupImages.map((i) => i.key).sort()).toEqual(sourceImages.map((i) => i.mediaKey).sort());

    // The source keeps its attributed order; the copy has none
    const attributed = await db.select({ landingPageId: schema.orders.landingPageId }).from(schema.orders)
      .where(eq(schema.orders.landingPageId, dup.data.id));
    expect(attributed).toHaveLength(0);
    const kept = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(eq(schema.orders.landingPageId, sourceId));
    expect(kept).toHaveLength(1);
  });

  it("duplicate: copies the page's own documents for every theme, addressed to the copy", async () => {
    const productId = await seedProduct();
    const created: any = await (await createLp({ name: "Designed", productId, slug: `dup-doc-${crypto.randomUUID().slice(0, 6)}` })).json();
    const sourceId = created.data.id;
    const storeId = `store-dup-${crypto.randomUUID().slice(0, 6)}`;
    await db.insert(schema.stores).values({ id: storeId, name: "Dup store", lang: "ar", createdAt: NOW(), updatedAt: NOW() });
    const layout = { version: 1, surface: `lp:${sourceId}`, sections: [{ id: "faq", type: "faq" }, { id: "order", type: "landing-order" }], hiddenAreas: ["header"] };
    for (const themeKey of ["theme-00", "theme-baby"]) {
      await db.insert(schema.pageDocuments).values({ id: `pd-${themeKey}-${sourceId}`, storeId, themeKey, surface: `lp:${sourceId}`, document: JSON.stringify(layout), createdAt: NOW(), updatedAt: NOW() });
    }
    const dup: any = await (await app.request(`/api/landing-pages/${sourceId}/duplicate`, { method: "POST" })).json();
    const copies = await db.select().from(schema.pageDocuments).where(eq(schema.pageDocuments.surface, `lp:${dup.data.id}`)).all();
    expect(copies.map((row) => row.themeKey).sort()).toEqual(["theme-00", "theme-baby"]);
    for (const copy of copies) expect(JSON.parse(copy.document)).toEqual({ ...layout, surface: `lp:${dup.data.id}` });
    expect(await db.select().from(schema.pageDocuments).where(eq(schema.pageDocuments.surface, `lp:${sourceId}`)).all()).toHaveLength(2);
  });

  it("deleting an image on the ORIGINAL leaves the shared file while the duplicate shows it", async () => {
    const productId = await seedProduct();
    const created: any = await (await createLp({ name: "Shared Key Original", productId, slug: `shared-${crypto.randomUUID().slice(0, 6)}` })).json();
    const sourceId = created.data.id;
    const sharedKey = `landing/shared-${crypto.randomUUID().slice(0, 6)}.jpg`;

    await addImage(sourceId, sharedKey);
    const dup: any = await (await app.request(`/api/landing-pages/${sourceId}/duplicate`, { method: "POST" })).json();

    // Delete the image on the ORIGINAL — the duplicate still references the key
    const sourceImages = await db.select().from(schema.landingPageImages)
      .where(eq(schema.landingPageImages.landingPageId, sourceId));
    const del = await app.request(`/api/landing-pages/${sourceId}/images/${sourceImages[0].id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // The file stays (the duplicate's row still shows it)
    expect(await held(sharedKey)).toBe(true);
    const dupImages = await db.select().from(schema.landingPageImages)
      .where(eq(schema.landingPageImages.landingPageId, dup.data.id));
    expect(dupImages.map((i) => i.mediaKey)).toEqual([sharedKey]);

    // Now delete the duplicate's image too — the last one showing it goes, and the file with it
    const del2 = await app.request(`/api/landing-pages/${dup.data.id}/images/${dupImages[0].id}`, { method: "DELETE" });
    expect(del2.status).toBe(200);
    expect(await held(sharedKey)).toBe(false);
  });

  it("duplicate of a missing LP is a 404", async () => {
    const res = await app.request(`/api/landing-pages/lp-not-here/duplicate`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
