/**
 * Reviews as the merchant works with them, through the real /api/reviews
 * routes on real D1, the review's files in the store's media (the R2 host on
 * a real local bucket).
 *
 * Proved: the list shows landed reviews with their media and filters by
 * status, source and media; decisions need reviews:manage and never touch a
 * review still processing; removing a review or one file removes its stored
 * files after the rows; a store review names a product and a customer (or a
 * typed name), rests only on an order of that customer that brought the
 * product, is verified only when that order was delivered, and needs
 * reviews:create; its files go to the media job; removing a product removes
 * its reviews' files too. The store's review rules are the Reviews App's
 * (`endpoints/apps/reviews.e2e.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import type { ReviewMediaJob } from "@/lib/review-media/job";
import { removeProduct } from "@/lib/remove-product";
import reviewsRouter from "./routes";

const T = "2026-10-16T10:00:00.000Z";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(3)]);
const OGG = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, ...new Array(100).fill(1)]);
const ALL = ["reviews:read", "reviews:manage", "reviews:create"];

let d1: TestD1;
let bucket: R2Bucket;
let app: OpenAPIHono<AppContext>;
let scopes: string[];
let jobs: Array<{ id: string; params: ReviewMediaJob }>;

beforeAll(async () => {
  d1 = await createTestD1();
  bucket = d1.bucket;
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = {
      DB: d1.raw,
      MEDIA_BUCKET: bucket,
      ENVIRONMENT: "production",
      ...TEST_MEDIA_VARS,
      REVIEW_MEDIA_WORKFLOW: { create: async (options: { id: string; params: ReviewMediaJob }) => (jobs.push(options), {} as never) },
    } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Samia", role: "staff", status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/reviews", reviewsRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  scopes = ALL;
  jobs = [];
  const db = d1.db;
  for (const table of [schema.media, schema.activityLogs, schema.reviewMedia, schema.reviews, schema.shipments, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.deliveryCompanies, schema.stores]) {
    await db.delete(table);
  }
  const listed = await bucket.list();
  if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));

  await db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
  await db.insert(schema.customers).values([
    { id: "c1", name: "Karim Benali", phone: "0551234567", wilaya: "Alger", createdAt: T },
    { id: "c2", name: "Lina", phone: "0661234567", wilaya: "Oran", createdAt: T },
  ]);
  await db.insert(schema.deliveryCompanies).values({ id: "co", name: "ZR", nameAr: "-", code: "zr_express", provider: "zr_express", createdAt: T, updatedAt: T });
  await db.insert(schema.products).values([
    { id: "p1", name: "Robe", handle: "robe", price: 1500, createdAt: T, updatedAt: T },
    { id: "p2", name: "Foulard", handle: "foulard", price: 500, createdAt: T, updatedAt: T },
  ]);
  const order = { customerName: "Karim Benali", phone: "0551234567", price: 1500, status: "ready" as const, updatedAt: T };
  await db.insert(schema.orders).values([
    { ...order, id: "oD", customerId: "c1", orderNumber: "ORD-20261010-1111", createdAt: "2026-10-10T10:00:00.000Z" },
    { ...order, id: "oT", customerId: "c1", orderNumber: "ORD-20261012-2222", createdAt: "2026-10-12T10:00:00.000Z" },
    { ...order, id: "oL", customerId: "c2", orderNumber: "ORD-20261012-3333", customerName: "Lina", createdAt: T },
  ]);
  await db.insert(schema.orderProducts).values([
    { id: "l1", orderId: "oD", productId: "p1", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
    { id: "l2", orderId: "oT", productId: "p1", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
    { id: "l3", orderId: "oL", productId: "p1", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
  ]);
  const shipment = { kind: "carrier" as const, companyId: "co", handoffState: "accepted" as const, deliveryType: "home" as const, codAmount: 1500, revision: 1, createdAt: T, updatedAt: T };
  await db.insert(schema.shipments).values([
    { ...shipment, id: "shD", orderId: "oD", carrierParcelId: "P-1", deliveredAt: T },
    { ...shipment, id: "shT", orderId: "oT", carrierParcelId: "P-2" },
  ] as never);

  const review = { storeId: "s1", productId: "p1", rating: 5, body: "Très belle robe", updatedAt: T };
  await db.insert(schema.reviews).values([
    { ...review, id: "rA", orderId: "oD", customerId: "c1", orderNumber: "ORD-20261010-1111", customerName: "Karim", status: "pending", verified: true, createdAt: "2026-10-16T09:00:00.000Z" },
    { ...review, id: "rB", customerName: "Amina", status: "approved", source: "merchant", createdBy: "u0", createdAt: "2026-10-16T08:00:00.000Z" },
    { ...review, id: "rP", customerName: "Sofiane", status: "processing", createdAt: "2026-10-16T09:30:00.000Z" },
  ]);
  await db.insert(schema.reviewMedia).values([
    { id: "m1", reviewId: "rA", kind: "image", mediaKey: "reviews/rA/m1.webp", thumbKey: "reviews/rA/m1-t.webp", contentType: "image/webp", bytes: 9000, width: 1600, height: 1200, position: 0, createdAt: T },
    { id: "m2", reviewId: "rA", kind: "audio", mediaKey: "reviews/rA/m2.ogg", contentType: "audio/ogg", bytes: 7000, durationMs: 12000, position: 1, createdAt: T },
  ]);
  const media = testMedia(d1);
  for (const key of ["reviews/rA/m1.webp", "reviews/rA/m1-t.webp"]) await media.store({ key, contentType: "image/webp", body: webp() });
  await media.store({ key: "reviews/rA/m2.ogg", contentType: "audio/ogg", body: OGG });
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/reviews${path}`, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
const json = async <T = any>(res: Response) => (await res.json()) as T;
const stored = async (prefix = "") => (await bucket.list({ prefix })).objects.map((o) => o.key).sort();

describe("the moderation list", () => {
  it("shows landed reviews with their media, newest first, and the queue's size", async () => {
    const res = await json(await call("GET", ""));
    expect(res.data.map((r: { id: string }) => r.id)).toEqual(["rA", "rB"]);
    expect(res.pendingCount).toBe(1);
    expect(res.data[0]).toMatchObject({
      productName: "Robe", orderNumber: "ORD-20261010-1111", source: "storefront", verified: true,
      media: [
        { id: "m1", kind: "image", url: `${TEST_DELIVERY.origin}/reviews/rA/m1.webp`, thumbUrl: `${TEST_DELIVERY.origin}/reviews/rA/m1-t.webp`, width: 1600 },
        { id: "m2", kind: "audio", url: `${TEST_DELIVERY.origin}/reviews/rA/m2.ogg`, thumbUrl: null, durationMs: 12000 },
      ],
    });
    expect(res.data[0].media[0].r2Key).toBeUndefined();
    expect(res.data[0].media[0].mediaKey).toBeUndefined();
  });

  it("filters by status, by who entered it, and by having media", async () => {
    expect((await json(await call("GET", "?source=merchant"))).data.map((r: { id: string }) => r.id)).toEqual(["rB"]);
    expect((await json(await call("GET", "?withMedia=true"))).data.map((r: { id: string }) => r.id)).toEqual(["rA"]);
    expect((await json(await call("GET", "?status=approved"))).data.map((r: { id: string }) => r.id)).toEqual(["rB"]);
  });
});

describe("decisions", () => {
  it("approves with reviews:manage, and logs it", async () => {
    const res = await call("PATCH", "/rA", { status: "approved" });
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("approved");
    expect((await d1.db.select().from(schema.activityLogs).all()).map((l) => l.action)).toEqual(["review.approved"]);
  });

  it("never touches a review still processing", async () => {
    expect((await call("PATCH", "/rP", { status: "approved" })).status).toBe(404);
    expect((await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, "rP")).get())?.status).toBe("processing");
    expect((await call("DELETE", "/rP")).status).toBe(404);
  });

  it("refuses without the right permission", async () => {
    scopes = ["reviews:read"];
    expect((await call("PATCH", "/rA", { status: "approved" })).status).toBe(403);
    expect((await call("DELETE", "/rA")).status).toBe(403);
    expect((await call("POST", "", { productId: "p1", customerName: "X", rating: 5, body: "Très bien reçu" })).status).toBe(403);
    scopes = ["reviews:read", "reviews:manage"];
    expect((await call("POST", "", { productId: "p1", customerName: "X", rating: 5, body: "Très bien reçu" })).status).toBe(403);
  });
});

describe("removing", () => {
  it("a review takes its stored files with it", async () => {
    expect((await call("DELETE", "/rA")).status).toBe(200);
    expect(await d1.db.select().from(schema.reviewMedia).all()).toEqual([]);
    expect(await stored("reviews/")).toEqual([]);
  });

  it("one photo leaves the review and its other files", async () => {
    const res = await json(await call("DELETE", "/rA/media/m1"));
    expect(res.data.media.map((m: { id: string }) => m.id)).toEqual(["m2"]);
    expect(await stored("reviews/")).toEqual(["reviews/rA/m2.ogg"]);
    expect((await d1.db.select().from(schema.activityLogs).all()).map((l) => l.action)).toEqual(["review.media_removed"]);
    expect((await call("DELETE", "/rB/media/m2")).status).toBe(404);
  });

  it("a product takes its reviews' files with it", async () => {
    await removeProduct(d1.db, { DB: d1.raw, MEDIA_BUCKET: bucket, ...TEST_MEDIA_VARS } as never, "p1");
    expect(await d1.db.select().from(schema.reviews).all()).toEqual([]);
    expect(await stored("reviews/")).toEqual([]);
  });
});

describe("entering a review the store received", () => {
  const entered = { productId: "p2", rating: 5, body: "Reçu par WhatsApp, très contente" };

  it("names a customer of the list, under their name, published at once", async () => {
    const res = await call("POST", "", { ...entered, customerId: "c2" });
    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(data).toMatchObject({ status: "approved", verified: false, review: { customerName: "Lina", source: "merchant", createdBy: "u1", orderId: null } });
    expect((await d1.db.select().from(schema.activityLogs).all()).map((l) => l.action)).toEqual(["review.created"]);
  });

  it("takes a typed name without a customer, and can wait for review", async () => {
    const { data } = await json(await call("POST", "", { ...entered, customerName: "Mme Yasmine", publish: false }));
    expect(data).toMatchObject({ status: "pending", review: { customerName: "Mme Yasmine", customerId: null } });
    expect(await json(await call("POST", "", entered))).toMatchObject({ code: "REQUIRED_FIELD_MISSING" });
  });

  it("is a verified purchase only on a delivered order of that customer that brought the product", async () => {
    const options = (await json(await call("GET", "/order-options?customerId=c1&productId=p1"))).data;
    expect(options).toEqual([
      { id: "oT", orderNumber: "ORD-20261012-2222", createdAt: expect.any(String), delivered: false, reviewed: false },
      { id: "oD", orderNumber: "ORD-20261010-1111", createdAt: expect.any(String), delivered: true, reviewed: true },
    ]);
    const onTheWay = await json(await call("POST", "", { ...entered, productId: "p1", customerId: "c1", orderId: "oT" }));
    expect(onTheWay.data).toMatchObject({ verified: false, review: { orderNumber: "ORD-20261012-2222" } });

    await d1.db.delete(schema.reviews).where(eq(schema.reviews.id, "rA"));
    const delivered = await json(await call("POST", "", { ...entered, productId: "p1", customerId: "c1", orderId: "oD", customerName: "Karim B." }));
    expect(delivered.data).toMatchObject({ verified: true, review: { customerName: "Karim B.", orderId: "oD", verified: true } });
  });

  it("refuses an order of another customer, one that did not bring the product, or one already reviewed", async () => {
    expect(await json(await call("POST", "", { ...entered, productId: "p1", customerId: "c2", orderId: "oD" }))).toMatchObject({ code: "PRODUCT_NOT_IN_ORDER" });
    expect(await json(await call("POST", "", { ...entered, customerId: "c1", orderId: "oD" }))).toMatchObject({ code: "PRODUCT_NOT_IN_ORDER" });
    expect((await call("POST", "", { ...entered, productId: "p1", customerId: "c1", orderId: "oD" })).status).toBe(409);
    expect(await json(await call("POST", "", { ...entered, customerName: "X", orderId: "oD" }))).toMatchObject({ code: "REQUIRED_FIELD_MISSING" });
    expect((await call("POST", "", { ...entered, productId: "nope", customerName: "X" })).status).toBe(404);
    expect((await call("POST", "", { ...entered, customerId: "nope" })).status).toBe(404);
  });

  it("sends its photos and voice note to the media job; a voice note may stand for the text", async () => {
    const photo = (await json(await app.request("/api/reviews/uploads", { method: "POST", body: JPEG }))).data;
    const voice = (await json(await app.request("/api/reviews/uploads", { method: "POST", headers: { "X-Media-Duration-Ms": "15000" }, body: OGG }))).data;
    expect([photo.kind, voice.kind]).toEqual(["image", "audio"]);
    expect(await stored("staging/reviews/staff/u1/")).toHaveLength(2);

    const { data } = await json(await call("POST", "", { productId: "p2", customerId: "c2", rating: 4, body: "", uploads: [photo.uploadId, voice.uploadId], publish: false }));
    expect(data).toMatchObject({ status: "processing", review: null });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].params).toMatchObject({ voiceMaxSeconds: 120, statusWithMedia: "pending", statusWithoutMedia: "pending" });
    expect(jobs[0].params.uploads.map((u) => u.kind)).toEqual(["image", "audio"]);
    expect(jobs[0].params.uploads[1].declaredDurationMs).toBe(15000);

    expect(await json(await call("POST", "", { productId: "p2", customerId: "c2", rating: 4, body: "ok", uploads: [photo.uploadId] }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await json(await call("POST", "", { ...entered, customerId: "c2", uploads: ["f".repeat(32)] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND" });
  });

  it("refuses an upload that is not a photo or voice note", async () => {
    const res = await app.request("/api/reviews/uploads", { method: "POST", body: new TextEncoder().encode("%PDF-1.7") });
    expect(await json(res)).toMatchObject({ code: "INVALID_FILE_TYPE" });
    scopes = ["reviews:read", "reviews:manage"];
    expect((await app.request("/api/reviews/uploads", { method: "POST", body: JPEG })).status).toBe(403);
  });
});
