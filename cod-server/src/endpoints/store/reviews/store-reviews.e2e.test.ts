/**
 * A shopper's review through the real /store/reviews routes, on real D1 and
 * a real (local) R2 bucket: find the order, send files, submit, and see it
 * listed.
 *
 * Proved: the purchase is proven by number and phone, and only for a
 * delivered order; uploads need the grant, are typed by their bytes and
 * bounded by the store's choices; a submission is answered at once and hands
 * its files to the media job, or lands without them when the job cannot
 * start; text publishes or waits as the merchant chose; one review per
 * product of an order, even when two submissions race; attempts are limited
 * per order; the list shows only approved reviews and nothing internal; a
 * store that turned reviews off takes and shows none.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Miniflare } from "miniflare";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { readUploadGrant } from "@/lib/review-media/grant";
import type { ReviewMediaJob } from "@/lib/review-media/job";
import reviewsRouter from "./routes";

const T = "2026-10-16T10:00:00.000Z";
const SECRET = "review-grant-test-secret";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(300).fill(1)]);

let d1: TestD1;
let r2mf: Miniflare;
let bucket: R2Bucket;
let app: OpenAPIHono<AppContext>;
let jobs: Array<{ id: string; params: ReviewMediaJob }>;
let workflowDown: boolean;
let limiterKeys: string[];
let limitReached: boolean;
let mediaOn: boolean;

beforeAll(async () => {
  d1 = await createTestD1();
  r2mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["IMAGES"] });
  bucket = (await r2mf.getR2Bucket("IMAGES")) as unknown as R2Bucket;
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = {
      DB: d1.raw,
      IMAGES: bucket,
      MEDIA_DOMAIN: "media.example.com",
      REVIEW_UPLOAD_SECRET: mediaOn ? SECRET : undefined,
      REVIEW_MEDIA_WORKFLOW: mediaOn
        ? {
            create: async (options: { id: string; params: ReviewMediaJob }) => {
              if (workflowDown) throw new Error("Workflows unavailable");
              jobs.push(options);
              return {} as never;
            },
          }
        : undefined,
      REVIEW_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          limiterKeys.push(key);
          return { success: !limitReached };
        },
      },
    } as never;
    c.set("storeId", "s1");
    await next();
  });
  app.onError(errorHandler);
  app.route("/store/reviews", reviewsRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
  await r2mf?.dispose();
});

beforeEach(async () => {
  jobs = [];
  workflowDown = false;
  limiterKeys = [];
  limitReached = false;
  mediaOn = true;
  const db = d1.db;
  for (const table of [schema.reviewMedia, schema.reviews, schema.shipments, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.deliveryCompanies, schema.stores]) {
    await db.delete(table);
  }
  const listed = await bucket.list();
  if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));

  await db.insert(schema.stores).values({ id: "s1", name: "Store", reviewMaxPhotos: 2, reviewVoiceMaxSeconds: 30, reviewAutoPublish: "text_only", createdAt: T, updatedAt: T });
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await db.insert(schema.deliveryCompanies).values({ id: "co", name: "ZR", nameAr: "-", code: "zr_express", provider: "zr_express", createdAt: T, updatedAt: T });
  const product = { price: 1500, createdAt: T, updatedAt: T };
  await db.insert(schema.products).values([
    { ...product, id: "p1", name: "Robe", handle: "robe" },
    { ...product, id: "p2", name: "Foulard", handle: "foulard" },
    { ...product, id: "p9", name: "Autre", handle: "autre" },
  ]);
  const order = { customerId: "c1", customerName: "Karim", phone: "0551234567", price: 2000, status: "ready" as const, createdAt: T, updatedAt: T };
  await db.insert(schema.orders).values([
    { ...order, id: "oD", orderNumber: "ORD-20261016-1111" },
    { ...order, id: "oT", orderNumber: "ORD-20261016-2222" },
  ]);
  await db.insert(schema.orderProducts).values([
    { id: "l1", orderId: "oD", productId: "p1", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
    { id: "l2", orderId: "oD", productId: "p2", productName: "Foulard", quantity: 1, pricePerUnit: 500, lineTotal: 500, createdAt: T },
    { id: "l3", orderId: "oT", productId: "p1", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
  ]);
  const shipment = { kind: "carrier" as const, companyId: "co", handoffState: "accepted" as const, deliveryType: "home" as const, codAmount: 2000, revision: 1, createdAt: T, updatedAt: T };
  await db.insert(schema.shipments).values([
    { ...shipment, id: "shD", orderId: "oD", carrierParcelId: "P-1", deliveredAt: T },
    { ...shipment, id: "shT", orderId: "oT", carrierParcelId: "P-2" },
  ] as never);
});

const json = (method: string, path: string, body: unknown) =>
  app.request(`/store/reviews${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const upload = (grant: string | undefined, bytes: Uint8Array) =>
  app.request("/store/reviews/uploads", { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...(grant ? { "X-Review-Grant": grant } : {}) }, body: bytes });
const body = async <T = any>(res: Response) => (await res.json()) as T;
const open = async (phone = "0551 23 45 67", orderNumber = "ORD-20261016-1111") => json("POST", "/eligibility", { orderNumber, phone });
const review = { orderNumber: "ORD-20261016-1111", phone: "0551234567", productId: "p1", rating: 5, body: "Très belle robe, bien reçue" };

describe("finding the order to review", () => {
  it("proves the purchase and says what can be reviewed and attached", async () => {
    const res = await open();
    expect(res.status).toBe(200);
    const { data } = await body(res);
    expect(data).toMatchObject({
      orderNumber: "ORD-20261016-1111",
      customerName: "Karim",
      products: [
        { productId: "p1", name: "Robe", reviewed: false },
        { productId: "p2", name: "Foulard", reviewed: false },
      ],
      media: { maxPhotos: 2, voiceMaxSeconds: 30 },
    });
    expect(await readUploadGrant(SECRET, data.media.grant)).toMatchObject({ orderId: "oD", maxPhotos: 2, voiceMaxSeconds: 30 });
    expect(limiterKeys).toEqual(["review:ORD-20261016-1111"]);
  });

  it("answers a wrong phone like an unknown order, and an undelivered order plainly", async () => {
    expect(await body(await open("0661234567"))).toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect((await open("0661234567")).status).toBe(404);
    const res = await open("0551234567", "ORD-20261016-2222");
    expect(res.status).toBe(422);
    expect(await body(res)).toMatchObject({ code: "REVIEW_ORDER_NOT_DELIVERED" });
  });

  it("offers text only when the store takes no media, or media is not set up", async () => {
    await d1.db.update(schema.stores).set({ reviewMaxPhotos: 0, reviewVoiceMaxSeconds: null });
    expect((await body(await open())).data.media).toBeNull();
    await d1.db.update(schema.stores).set({ reviewMaxPhotos: 3 });
    mediaOn = false;
    expect((await body(await open())).data.media).toBeNull();
  });

  it("stops after too many attempts for one order", async () => {
    limitReached = true;
    const res = await open();
    expect(res.status).toBe(422);
    expect(await body(res)).toMatchObject({ code: "REVIEW_RATE_LIMITED" });
  });

  it("takes nothing when the store turned reviews off", async () => {
    await d1.db.update(schema.stores).set({ reviewsEnabled: false });
    expect(await body(await open())).toMatchObject({ code: "REVIEWS_DISABLED" });
    expect(await body(await json("POST", "", review))).toMatchObject({ code: "REVIEWS_DISABLED" });
  });
});

describe("sending files", () => {
  const grant = async () => (await body(await open())).data.media.grant as string;

  it("keeps a photo and a voice note under the grant, typed by their bytes", async () => {
    const g = await grant();
    const photo = await upload(g, JPEG);
    expect(photo.status).toBe(201);
    expect((await body(photo)).data).toMatchObject({ kind: "image", bytes: JPEG.byteLength });
    const voice = await upload(g, WEBM);
    expect((await body(voice)).data).toMatchObject({ kind: "audio" });
    const stored = await bucket.list({ prefix: "review-uploads/", include: ["customMetadata", "httpMetadata"] });
    expect(stored.objects.map((o) => [o.customMetadata?.kind, o.httpMetadata?.contentType]).sort()).toEqual([["audio", "audio/webm"], ["image", "image/jpeg"]]);
  });

  it("refuses without a valid grant", async () => {
    expect(await body(await upload(undefined, JPEG))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
    expect(await body(await upload("forged.token", JPEG))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
  });

  it("refuses what is not a photo or a voice note, whatever it says it is", async () => {
    const res = await upload(await grant(), new TextEncoder().encode("<svg onload=alert(1)></svg>"));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "INVALID_FILE_TYPE" });
    expect((await bucket.list()).objects).toHaveLength(0);
  });

  it("refuses a file larger than the store allows, without storing it", async () => {
    const tooLong = new Uint8Array(30 * 24 * 1024 + 64 * 1024 + 1);
    tooLong.set([0x1a, 0x45, 0xdf, 0xa3]);
    await d1.db.update(schema.stores).set({ reviewMaxPhotos: 0 });
    const res = await upload(await grant(), tooLong);
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect((await bucket.list()).objects).toHaveLength(0);
  });

  it("stops reading a streamed file that grows past the limit, even with no length announced", async () => {
    const g = await grant();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 12 * 1024 * 1024) return controller.close();
        const chunk = new Uint8Array(256 * 1024);
        if (sent === 0) chunk.set(JPEG.subarray(0, 4));
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await app.request("/store/reviews/uploads", { method: "PUT", headers: { "X-Review-Grant": g }, body: stream, duplex: "half" } as RequestInit);
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(sent).toBeLessThan(12 * 1024 * 1024);
    expect((await bucket.list()).objects).toHaveLength(0);
  });

  it("refuses a kind the store does not take", async () => {
    await d1.db.update(schema.stores).set({ reviewVoiceMaxSeconds: null });
    const res = await upload(await grant(), WEBM);
    expect(await body(res)).toMatchObject({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "audio", max: 0 } });
  });

  it("bounds how many files one grant takes", async () => {
    const g = await grant();
    for (let i = 0; i < 4; i++) expect((await upload(g, JPEG)).status).toBe(201);
    expect(await body(await upload(g, JPEG))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT" });
  });
});

describe("submitting", () => {
  it("records a text review and publishes it at once when the store chose so", async () => {
    const res = await json("POST", "", { ...review, title: "  Parfait  " });
    expect(res.status).toBe(201);
    const { data } = await body(res);
    expect(data.visibility).toBe("published");
    expect(await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, data.id)).get()).toMatchObject({
      productId: "p1", orderId: "oD", customerId: "c1", orderNumber: "ORD-20261016-1111", customerName: "Karim",
      rating: 5, title: "Parfait", status: "approved", source: "storefront", verified: true, mediaDropped: 0,
    });
    expect(jobs).toEqual([]);
  });

  it("keeps a text review waiting when the store checks everything", async () => {
    await d1.db.update(schema.stores).set({ reviewAutoPublish: "off" });
    expect((await body(await json("POST", "", review))).data.visibility).toBe("after_review");
  });

  it("answers at once with files, and hands them to the media job", async () => {
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    const voice = (await body(await upload(opened.media.grant, WEBM))).data.uploadId;
    const res = await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo, voice] });
    expect(res.status).toBe(201);
    const { data } = await body(res);
    expect(data.visibility).toBe("after_review");

    expect((await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, data.id)).get())?.status).toBe("processing");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(`review-${data.id}`);
    expect(jobs[0].params).toMatchObject({ reviewId: data.id, voiceMaxSeconds: 30, statusWithMedia: "pending", statusWithoutMedia: "approved" });
    expect(jobs[0].params.uploads.map((u) => [u.kind, u.contentType, u.bytes])).toEqual([["image", "image/jpeg", JPEG.byteLength], ["audio", "audio/webm", WEBM.byteLength]]);
  });

  it("keeps the review without its files when the media job cannot start", async () => {
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    workflowDown = true;
    const { data } = await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo] }));
    expect(data.visibility).toBe("published");
    expect(await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, data.id)).get()).toMatchObject({ status: "approved", mediaDropped: 1 });
  });

  it("refuses files of another order's grant, files never sent, and more than the store allows", async () => {
    const opened = (await body(await open())).data;
    const photos = [];
    for (let i = 0; i < 3; i++) photos.push((await body(await upload(opened.media.grant, JPEG))).data.uploadId);
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: photos }))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "image", max: 2 } });
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: ["f".repeat(32)] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND" });
    expect(await body(await json("POST", "", { ...review, uploads: [photos[0]] }))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });

    await d1.db.update(schema.shipments).set({ deliveredAt: T }).where(eq(schema.shipments.id, "shT"));
    const other = (await body(await open("0551234567", "ORD-20261016-2222"))).data;
    expect(await body(await json("POST", "", { ...review, grant: other.media.grant, uploads: [photos[0]] }))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
    expect(await d1.db.select().from(schema.reviews).all()).toEqual([]);
  });

  it("one review per product of an order, even when two race", async () => {
    const [a, b] = await Promise.all([json("POST", "", review), json("POST", "", review)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await body(await json("POST", "", review))).toMatchObject({ code: "ORDER_ALREADY_REVIEWED" });
    expect((await json("POST", "", { ...review, productId: "p2" })).status).toBe(201);
    expect((await body(await open())).data.products.map((p: { reviewed: boolean }) => p.reviewed)).toEqual([true, true]);
    expect((await body(await open())).data.media).toBeNull();
  });

  it("refuses a product the order did not bring, and an undelivered order", async () => {
    expect(await body(await json("POST", "", { ...review, productId: "p9" }))).toMatchObject({ code: "PRODUCT_NOT_IN_ORDER" });
    expect(await body(await json("POST", "", { ...review, orderNumber: "ORD-20261016-2222" }))).toMatchObject({ code: "REVIEW_ORDER_NOT_DELIVERED" });
    expect(await body(await json("POST", "", { ...review, phone: "0771234567" }))).toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("still takes a text review from a storefront that sends no phone, for a delivered order only", async () => {
    const legacy = { orderNumber: "ORD-20261016-1111", productId: "p1", rating: 4, title: "Bien", body: "Bonne qualité, merci" };
    expect((await json("POST", "", legacy)).status).toBe(201);
    expect(await body(await json("POST", "", { ...legacy, orderNumber: "ORD-20261016-2222" }))).toMatchObject({ code: "REVIEW_ORDER_NOT_DELIVERED" });
  });

  it("refuses a body too short to say anything, and stars out of range", async () => {
    expect((await json("POST", "", { ...review, body: "ok" })).status).toBe(400);
    expect((await json("POST", "", { ...review, rating: 6 })).status).toBe(400);
    expect((await json("POST", "", { ...review, orderNumber: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" })).status).toBe(400);
  });
});

describe("the storefront list", () => {
  it("shows approved reviews with their media, and nothing internal", async () => {
    const { data } = await body(await json("POST", "", review));
    await d1.db.insert(schema.reviewMedia).values([
      { id: "m2", reviewId: data.id, kind: "audio", r2Key: `reviews/${data.id}/m2.webm`, contentType: "audio/webm", bytes: 9000, durationMs: 21000, position: 1, createdAt: T },
      { id: "m1", reviewId: data.id, kind: "image", r2Key: `reviews/${data.id}/m1.webp`, thumbKey: `reviews/${data.id}/m1-t.webp`, contentType: "image/webp", bytes: 50000, width: 1600, height: 1200, position: 0, createdAt: T },
    ]);
    await json("POST", "", { ...review, productId: "p2" });
    await d1.db.update(schema.reviews).set({ status: "pending" }).where(eq(schema.reviews.productId, "p2"));

    const res = await app.request("/store/reviews?productId=p1");
    const listed = await body(res);
    expect(listed.total).toBe(1);
    expect(listed.data).toEqual([
      {
        id: data.id, customerName: "Karim", rating: 5, title: null, body: "Très belle robe, bien reçue", createdAt: expect.any(String), verified: true,
        media: [
          { id: "m1", kind: "image", url: `https://media.example.com/reviews/${data.id}/m1.webp`, thumbUrl: `https://media.example.com/reviews/${data.id}/m1-t.webp`, width: 1600, height: 1200, durationMs: null },
          { id: "m2", kind: "audio", url: `https://media.example.com/reviews/${data.id}/m2.webm`, thumbUrl: null, width: null, height: null, durationMs: 21000 },
        ],
      },
    ]);
    expect((await body(await app.request("/store/reviews?productId=p2"))).data).toEqual([]);
  });

  it("is empty when the store turned reviews off", async () => {
    await json("POST", "", review);
    await d1.db.update(schema.stores).set({ reviewsEnabled: false });
    expect(await body(await app.request("/store/reviews?productId=p1"))).toMatchObject({ data: [], total: 0 });
  });
});
