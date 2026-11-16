/**
 * A shopper's review through the real /store/reviews routes, on real D1 and
 * the store's own media host — its real (local) bucket, or ImageKit with no
 * bucket at all: find the order, send files, submit, and see it listed.
 *
 * Proved: the purchase is proven by number and phone, and only for a
 * delivered order; uploads need the grant, are typed by their bytes, bounded
 * by the store's choices, prepared as they arrive (a photo becomes WebP and a
 * thumbnail, a voice note is measured) and kept on the store's host, nowhere
 * else; a submission records the review with its files in one write and it
 * lands at once, published or waiting as the merchant chose; a file is one
 * review's only; one review per product of an order, even when two
 * submissions race; attempts are limited per order; the list shows only
 * approved reviews and nothing internal; a store that turned reviews off
 * takes and shows none.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_IMAGEKIT, TEST_IMAGEKIT_VARS, TEST_MEDIA_VARS, routeImageKit } from "@/test-utils/media";
import { fakeImages, mediaFixture, type FakeImages } from "@/test-utils/images";
import { fakeImageKit, type FakeImageKit } from "../../../../../cod-shared/media/hosts/testing/fake-imagekit";
import * as schema from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { readUploadGrant } from "@/lib/review-media/grant";
import { audioDurationMs } from "@/lib/review-media/audio-duration";
import reviewsRouter from "./routes";

const T = "2026-10-16T10:00:00.000Z";
const SECRET = "review-grant-test-secret-of-32-bytes-at-least";
const JPEG = mediaFixture("photo.jpg");
const WEBM = mediaFixture("voice.webm");
const LONG_OGG = mediaFixture("voice-40s.ogg");

let d1: TestD1;
let bucket: R2Bucket;
let app: OpenAPIHono<AppContext>;
let images: FakeImages;
let imagesOn: boolean;
let host: "r2" | "imagekit";
let limiterKeys: string[];
let limitReached: boolean;
let mediaOn: boolean;

beforeAll(async () => {
  d1 = await createTestD1();
  bucket = d1.bucket;
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = {
      DB: d1.raw,
      ...(host === "r2" ? { ...TEST_MEDIA_VARS, MEDIA_BUCKET: bucket } : TEST_IMAGEKIT_VARS),
      IMAGE_TRANSFORM: imagesOn ? images.binding : undefined,
      ENVIRONMENT: "production",
      REVIEW_UPLOAD_SECRET: mediaOn ? SECRET : undefined,
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
});

beforeEach(async () => {
  images = fakeImages();
  imagesOn = true;
  host = "r2";
  limiterKeys = [];
  limitReached = false;
  mediaOn = true;
  const db = d1.db;
  for (const table of [schema.reviewMedia, schema.reviews, schema.media, schema.shipments, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.deliveryCompanies, schema.stores]) {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (method: string, path: string, body: unknown) =>
  app.request(`/store/reviews${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const upload = (grant: string | undefined, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  app.request("/store/reviews/uploads", { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...(grant ? { "X-Review-Grant": grant } : {}), ...headers }, body: bytes });
const body = async <T = any>(res: Response) => (await res.json()) as T;
const open = async (phone = "0551 23 45 67", orderNumber = "ORD-20261016-1111") => json("POST", "/eligibility", { orderNumber, phone });
const review = { orderNumber: "ORD-20261016-1111", phone: "0551234567", productId: "p1", rating: 5, body: "Très belle robe, bien reçue" };
const bucketKeys = async () => (await bucket.list()).objects.map((o) => o.key).sort();
const kept = async () => (await d1.db.select({ key: schema.media.key, host: schema.media.host, contentType: schema.media.contentType, durationMs: schema.media.durationMs, status: schema.media.status }).from(schema.media).orderBy(asc(schema.media.key)).all());
const reviewFiles = (reviewId: string) => d1.db.select().from(schema.reviewMedia).where(eq(schema.reviewMedia.reviewId, reviewId)).orderBy(asc(schema.reviewMedia.position)).all();
const onImageKit = (): FakeImageKit => {
  host = "imagekit";
  const fake = fakeImageKit(TEST_IMAGEKIT);
  routeImageKit(fake, vi.stubGlobal);
  return fake;
};

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

  it("names each product's photo as an image and as the URL a storefront on @wocart/storefront 2.0 reads", async () => {
    await d1.db.insert(schema.productImages).values({ id: "img1", productId: "p1", mediaKey: "products/robe.webp", width: 800, height: 1000, position: 1, createdAt: T, updatedAt: T } as never);
    const { data } = await body(await open());
    const url = `${TEST_DELIVERY.origin}/products/robe.webp`;
    expect(data.products[0]).toMatchObject({ productId: "p1", image: { key: "products/robe.webp", url }, imageSrc: url });
    expect(data.products[1]).toMatchObject({ productId: "p2", image: null, imageSrc: null });
    await d1.db.delete(schema.productImages);
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

  it("asks no Turnstile token, even when the store guards its checkout with one", async () => {
    await d1.db.insert(schema.storeTurnstileConfig).values({ id: "ts1", storeId: "s1", siteKey: "site", secretKey: "secret", enabled: true, createdAt: T, updatedAt: T } as never);
    expect((await open()).status).toBe(200);
    await d1.db.delete(schema.storeTurnstileConfig);
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

  it("prepares a photo into WebP and its thumbnail, measures a voice note, and keeps them in the store's bucket under the grant", async () => {
    const g = await grant();
    const folder = (await readUploadGrant(SECRET, g))!.id;
    const photo = await upload(g, JPEG);
    expect(photo.status).toBe(201);
    const photoId = (await body(photo)).data.uploadId;
    expect((await body(await upload(g, JPEG))).data).toMatchObject({ kind: "image", bytes: JPEG.byteLength });
    const voice = (await body(await upload(g, WEBM))).data;
    expect(voice).toMatchObject({ kind: "audio", bytes: WEBM.byteLength });

    expect(images.calls).toEqual([
      { width: 1600, height: 1600, fit: "scale-down" }, { width: 480, height: 480, fit: "scale-down" },
      { width: 1600, height: 1600, fit: "scale-down" }, { width: 480, height: 480, fit: "scale-down" },
    ]);
    const rows = await kept();
    expect(rows.filter((row) => row.key.startsWith(`reviews/${folder}/${photoId}`))).toEqual([
      { key: `reviews/${folder}/${photoId}-t.webp`, host: "r2", contentType: "image/webp", durationMs: null, status: "ready" },
      { key: `reviews/${folder}/${photoId}.webp`, host: "r2", contentType: "image/webp", durationMs: null, status: "ready" },
    ]);
    const voiceRow = rows.find((row) => row.key === `reviews/${folder}/${voice.uploadId}.webm`)!;
    expect(voiceRow).toMatchObject({ host: "r2", contentType: "audio/webm", status: "ready" });
    expect(Math.abs(voiceRow.durationMs! - 3208)).toBeLessThanOrEqual(60);
    expect(await bucketKeys()).toEqual(rows.map((row) => row.key).sort());
    expect((await bucketKeys()).some((key) => key.startsWith("staging/"))).toBe(false);
  });

  it("on an ImageKit store, keeps everything in ImageKit: no bucket is bound, none is touched", async () => {
    const imagekit = onImageKit();
    const g = await grant();
    const folder = (await readUploadGrant(SECRET, g))!.id;
    const photoId = (await body(await upload(g, JPEG))).data.uploadId;
    const voiceId = (await body(await upload(g, WEBM))).data.uploadId;
    expect([...imagekit.files.keys()].sort()).toEqual([
      `/stores/maysa/reviews/${folder}/${photoId}-t.webp`,
      `/stores/maysa/reviews/${folder}/${photoId}.webp`,
      `/stores/maysa/reviews/${folder}/${voiceId}.webm`,
    ].sort());
    expect((await kept()).every((row) => row.host === "imagekit" && row.status === "ready")).toBe(true);
    expect(await bucketKeys()).toEqual([]);

    const { data } = await body(await json("POST", "", { ...review, grant: g, uploads: [photoId, voiceId] }));
    const files = await reviewFiles(data.id);
    expect(files.map((file) => [file.kind, file.mediaKey, file.thumbKey])).toEqual([
      ["image", `reviews/${folder}/${photoId}.webp`, `reviews/${folder}/${photoId}-t.webp`],
      ["audio", `reviews/${folder}/${voiceId}.webm`, null],
    ]);
    const listed = await body(await app.request("/store/reviews?productId=p1"));
    expect(listed.data).toEqual([]);
    await d1.db.update(schema.reviews).set({ status: "approved" });
    const shown = (await body(await app.request("/store/reviews?productId=p1"))).data[0];
    expect(shown.media[0]).toMatchObject({ url: `${TEST_IMAGEKIT_VARS.MEDIA_ORIGIN}/reviews/${folder}/${photoId}.webp`, thumbUrl: `${TEST_IMAGEKIT_VARS.MEDIA_ORIGIN}/reviews/${folder}/${photoId}-t.webp` });
  });

  it("refuses without a valid grant", async () => {
    expect(await body(await upload(undefined, JPEG))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
    expect(await body(await upload("forged.token", JPEG))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
  });

  it("refuses what is not a photo or a voice note, whatever it says it is", async () => {
    const res = await upload(await grant(), new TextEncoder().encode("<svg onload=alert(1)></svg>"));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "INVALID_FILE_TYPE" });
    expect(await bucketKeys()).toEqual([]);
    expect(await kept()).toEqual([]);
  });

  it("refuses a file larger than the store allows, without keeping it", async () => {
    const tooLong = new Uint8Array(30 * 24 * 1024 + 64 * 1024 + 1);
    tooLong.set([0x1a, 0x45, 0xdf, 0xa3]);
    await d1.db.update(schema.stores).set({ reviewMaxPhotos: 0 });
    const res = await upload(await grant(), tooLong);
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(await bucketKeys()).toEqual([]);
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
    expect(await bucketKeys()).toEqual([]);
  });

  it("refuses a voice note longer than the store allows, keeping nothing", async () => {
    const res = await upload(await grant(), LONG_OGG);
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "FILE_TOO_LARGE", context: { maxSeconds: 30 } });
    expect(await kept()).toEqual([]);
  });

  it("keeps the recorder's length only when the file does not say it, and never above the limit", async () => {
    const g = await grant();
    const fragmented = mediaFixture("voice-fragmented.m4a");
    await upload(g, fragmented, { "X-Media-Duration-Ms": "90000" });
    const [row] = (await kept()).filter((r) => r.contentType === "audio/mp4");
    expect(row!.durationMs).toBe(audioDurationMs(fragmented, "audio/mp4") ?? 30_000);
    await upload(g, WEBM, { "X-Media-Duration-Ms": "90000" });
    const [webm] = (await kept()).filter((r) => r.contentType === "audio/webm");
    expect(Math.abs(webm!.durationMs! - 3208)).toBeLessThanOrEqual(60);
  });

  it("refuses a photo nothing can read, and keeps nothing of it", async () => {
    images.failures.push("bad");
    const res = await upload(await grant(), JPEG);
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: "INVALID_FILE_TYPE" });
    expect(await kept()).toEqual([]);
  });

  it("answers a passing failure of the image service as one, so the browser sends the photo again", async () => {
    const g = await grant();
    images.failures.push("transient");
    expect((await upload(g, JPEG)).status).toBe(500);
    expect(await kept()).toEqual([]);
    expect((await upload(g, JPEG)).status).toBe(201);
  });

  it("offers no photos, and takes none, without the image service: a photo is never kept unconverted", async () => {
    imagesOn = false;
    const opened = (await body(await open())).data;
    expect(opened.media).toMatchObject({ maxPhotos: 0, voiceMaxSeconds: 30 });
    expect(await body(await upload(opened.media.grant, JPEG))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "image", max: 0 } });
    expect((await upload(opened.media.grant, WEBM)).status).toBe(201);
  });

  it("refuses a kind the store does not take", async () => {
    await d1.db.update(schema.stores).set({ reviewVoiceMaxSeconds: null });
    const res = await upload(await grant(), WEBM);
    expect(await body(res)).toMatchObject({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "audio", max: 0 } });
  });

  it("bounds how many files one grant holds before a review shows them", async () => {
    const g = await grant();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await upload(g, JPEG);
      expect(res.status).toBe(201);
      ids.push((await body(res)).data.uploadId);
    }
    expect(await body(await upload(g, JPEG))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT" });
    const folder = (await readUploadGrant(SECRET, g))!.id;
    await d1.db.update(schema.media).set({ status: "pending" }).where(eq(schema.media.key, `reviews/${folder}/${ids[3]}.webp`));
    const retried = await upload(g, JPEG);
    expect(retried.status, "a file whose keep never finished does not count").toBe(201);
    expect(await body(await upload(g, JPEG))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT" });
    expect((await json("POST", "", { ...review, grant: g, uploads: ids.slice(0, 2) })).status).toBe(201);
    expect((await upload(g, JPEG)).status).toBe(201);
    const another = await grant();
    expect(another).not.toBe(g);
    expect((await upload(another, JPEG)).status).toBe(201);
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
  });

  it("keeps a text review waiting when the store checks everything", async () => {
    await d1.db.update(schema.stores).set({ reviewAutoPublish: "off" });
    expect((await body(await json("POST", "", review))).data.visibility).toBe("after_review");
  });

  it("records the review with its files in one write, and it lands at once where the store chose", async () => {
    const opened = (await body(await open())).data;
    const folder = (await readUploadGrant(SECRET, opened.media.grant))!.id;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    const voice = (await body(await upload(opened.media.grant, WEBM))).data.uploadId;
    const res = await json("POST", "", { ...review, grant: opened.media.grant, uploads: [voice, photo] });
    expect(res.status).toBe(201);
    const { data } = await body(res);
    expect(data.visibility).toBe("after_review");

    expect(await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, data.id)).get()).toMatchObject({ status: "pending", mediaDropped: 0 });
    const files = await reviewFiles(data.id);
    expect(files.map((file) => ({ id: file.id, kind: file.kind, mediaKey: file.mediaKey, thumbKey: file.thumbKey, contentType: file.contentType, position: file.position }))).toEqual([
      { id: voice, kind: "audio", mediaKey: `reviews/${folder}/${voice}.webm`, thumbKey: null, contentType: "audio/webm", position: 0 },
      { id: photo, kind: "image", mediaKey: `reviews/${folder}/${photo}.webp`, thumbKey: `reviews/${folder}/${photo}-t.webp`, contentType: "image/webp", position: 1 },
    ]);
    expect(Math.abs(files[0]!.durationMs! - 3208)).toBeLessThanOrEqual(60);
    expect(files[1]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  });

  it("publishes a review with files at once when the store publishes everything", async () => {
    await d1.db.update(schema.stores).set({ reviewAutoPublish: "all" });
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    const { data } = await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo] }));
    expect(data.visibility).toBe("published");
    expect((await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, data.id)).get())?.status).toBe("approved");
  });

  it("refuses files of another order's grant, files never sent, and more than the store allows", async () => {
    const opened = (await body(await open())).data;
    const photos = [];
    for (let i = 0; i < 3; i++) photos.push((await body(await upload(opened.media.grant, JPEG))).data.uploadId);
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: photos }))).toMatchObject({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "image", max: 2 } });
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: ["f".repeat(32)] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND", context: { uploadId: "f".repeat(32) } });
    expect(await body(await json("POST", "", { ...review, uploads: [photos[0]] }))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });

    await d1.db.update(schema.shipments).set({ deliveredAt: T }).where(eq(schema.shipments.id, "shT"));
    const other = (await body(await open("0551234567", "ORD-20261016-2222"))).data;
    expect(await body(await json("POST", "", { ...review, grant: other.media.grant, uploads: [photos[0]] }))).toMatchObject({ code: "REVIEW_UPLOAD_GRANT_INVALID" });
    expect(await d1.db.select().from(schema.reviews).all()).toEqual([]);
  });

  it("gives a file to one review only: another review of the order cannot take it", async () => {
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    expect((await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo] })).status).toBe(201);
    expect(await body(await json("POST", "", { ...review, productId: "p2", grant: opened.media.grant, uploads: [photo] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND", context: { uploadId: photo } });
    expect(await d1.db.select().from(schema.reviews).all()).toHaveLength(1);
  });

  it("refuses a photo kept without its thumbnail, or a file that never became ready", async () => {
    const opened = (await body(await open())).data;
    const folder = (await readUploadGrant(SECRET, opened.media.grant))!.id;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    const voice = (await body(await upload(opened.media.grant, WEBM))).data.uploadId;
    await d1.db.delete(schema.media).where(eq(schema.media.key, `reviews/${folder}/${photo}-t.webp`));
    await d1.db.update(schema.media).set({ status: "pending" }).where(eq(schema.media.key, `reviews/${folder}/${voice}.webm`));
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND", context: { uploadId: photo } });
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: [voice] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND", context: { uploadId: voice } });
    expect(await d1.db.select().from(schema.reviews).all()).toEqual([]);
  });

  it("refuses a file kept on another host than the store's now", async () => {
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    onImageKit();
    expect(await body(await json("POST", "", { ...review, grant: opened.media.grant, uploads: [photo] }))).toMatchObject({ code: "REVIEW_UPLOAD_NOT_FOUND" });
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

  it("refuses a body too short to say anything — unless a voice note says it — and stars out of range", async () => {
    expect(await body(await json("POST", "", { ...review, body: "ok" }))).toMatchObject({ code: "VALIDATION_FAILED", context: { field: "body", min: 10 } });
    const opened = (await body(await open())).data;
    const photo = (await body(await upload(opened.media.grant, JPEG))).data.uploadId;
    expect(await body(await json("POST", "", { ...review, body: "", grant: opened.media.grant, uploads: [photo] }))).toMatchObject({ code: "VALIDATION_FAILED" });
    const voice = (await body(await upload(opened.media.grant, WEBM))).data.uploadId;
    expect((await json("POST", "", { ...review, body: "", grant: opened.media.grant, uploads: [voice] })).status).toBe(201);
    expect((await json("POST", "", { ...review, rating: 6 })).status).toBe(400);
    expect((await json("POST", "", { ...review, orderNumber: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" })).status).toBe(400);
  });
});

describe("the storefront list", () => {
  it("shows approved reviews with their media, and nothing internal", async () => {
    const { data } = await body(await json("POST", "", review));
    await d1.db.insert(schema.reviewMedia).values([
      { id: "m2", reviewId: data.id, kind: "audio", mediaKey: `reviews/${data.id}/m2.webm`, contentType: "audio/webm", bytes: 9000, durationMs: 21000, position: 1, createdAt: T },
      { id: "m1", reviewId: data.id, kind: "image", mediaKey: `reviews/${data.id}/m1.webp`, thumbKey: `reviews/${data.id}/m1-t.webp`, contentType: "image/webp", bytes: 50000, width: 1600, height: 1200, position: 0, createdAt: T },
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
          { id: "m1", kind: "image", url: `${TEST_DELIVERY.origin}/reviews/${data.id}/m1.webp`, thumbUrl: `${TEST_DELIVERY.origin}/reviews/${data.id}/m1-t.webp`, width: 1600, height: 1200, durationMs: null },
          { id: "m2", kind: "audio", url: `${TEST_DELIVERY.origin}/reviews/${data.id}/m2.webm`, thumbUrl: null, width: null, height: null, durationMs: 21000 },
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
