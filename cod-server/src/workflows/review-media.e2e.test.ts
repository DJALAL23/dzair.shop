/**
 * CodReviewMediaWorkflow on real D1 and a real (local) R2 bucket, with real
 * photos and recordings. The image service is a stand-in that answers with
 * real WebP files and can be made to fail; the step runner retries like
 * Workflows does (3 retries), then lets the failure through.
 *
 * Proved: photos are kept only as the image service's WebP (and its
 * thumbnail), never as sent; a voice note is kept as recorded when its kind,
 * weight and length fit; a file that can never be kept is dropped and
 * counted, a passing failure is retried, and the review always lands; a run
 * that repeats changes nothing; a review removed or settled meanwhile takes
 * the files back; the files as sent are cleared; a review whose job never
 * finished is settled by the sweep.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { CodReviewMediaWorkflow } from "./review-media";
import { runStuckReviewSweep } from "@/cron/settle-stuck-reviews";
import type { ReviewMediaJob } from "@/lib/review-media/job";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../lib/review-media/__fixtures__", name)));
const T = "2026-10-16T10:00:00.000Z";
const G = "a".repeat(32);
const id = (n: number) => String(n).repeat(32).slice(0, 32);

let d1: TestD1;
let r2mf: Miniflare;
let bucket: R2Bucket;
let imageCalls: Array<{ width?: number }>;
let imageFailures: Array<"transient" | "bad">;
let imagesOn: boolean;

const images = {
  input(stream: ReadableStream<Uint8Array>) {
    void stream.cancel();
    let edge = 0;
    const transformer = {
      transform(options: { width?: number }) {
        edge = options.width ?? 0;
        imageCalls.push(options);
        return transformer;
      },
      async output() {
        const failure = imageFailures.shift();
        if (failure === "bad") throw Object.assign(new Error("not an image"), { code: 9412 });
        if (failure === "transient") throw new Error("image service unavailable");
        const body = fixture(edge <= 480 ? "photo-thumb.webp" : "photo-full.webp");
        return { response: () => new Response(body, { headers: { "Content-Type": "image/webp" } }) };
      },
    };
    return transformer;
  },
} as unknown as ImagesBinding;

/** Runs steps like Workflows: a failing step is retried up to its limit, then its error goes to run(). */
const runner = (names: string[]) => ({
  async do<R>(name: string, configOrCallback: unknown, maybeCallback?: () => Promise<R>): Promise<R> {
    names.push(name);
    const callback = (maybeCallback ?? configOrCallback) as () => Promise<R>;
    const limit = (configOrCallback as { retries?: { limit: number } })?.retries?.limit ?? 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await callback();
        return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as R;
      } catch (error) {
        if (attempt >= limit) throw error;
      }
    }
  },
  async sleep() {},
  async sleepUntil() {},
});

const workflow = () => new CodReviewMediaWorkflow({} as never, { DB: d1.raw, IMAGES: bucket, IMAGE_TRANSFORM: imagesOn ? images : undefined } as never);
const run = async (job: ReviewMediaJob, steps: string[] = []) => workflow().run({ payload: job } as never, runner(steps) as never);

async function sent(uploadId: string, bytes: Uint8Array, kind: "image" | "audio", contentType: string, declaredDurationMs?: number) {
  const key = `review-uploads/${G}/${uploadId}`;
  await bucket.put(key, bytes, { customMetadata: { kind, contentType } });
  return { key, kind, contentType, bytes: bytes.byteLength, ...(declaredDurationMs ? { declaredDurationMs } : {}) };
}

const job = (uploads: ReviewMediaJob["uploads"], overrides: Partial<ReviewMediaJob> = {}): ReviewMediaJob => ({
  reviewId: "r1", uploads, voiceMaxSeconds: 30, statusWithMedia: "pending", statusWithoutMedia: "approved", ...overrides,
});
const review = () => d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, "r1")).get();
const media = () => d1.db.select().from(schema.reviewMedia).orderBy(schema.reviewMedia.position).all();
const keys = async (prefix: string) => (await bucket.list({ prefix })).objects.map((o) => o.key).sort();

beforeAll(async () => {
  d1 = await createTestD1();
  r2mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["IMAGES"] });
  bucket = (await r2mf.getR2Bucket("IMAGES")) as unknown as R2Bucket;
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
  await r2mf?.dispose();
});

beforeEach(async () => {
  imageCalls = [];
  imageFailures = [];
  imagesOn = true;
  for (const table of [schema.reviewMedia, schema.reviews, schema.products, schema.stores]) await d1.db.delete(table);
  const listed = await bucket.list();
  if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values({ id: "p1", name: "Robe", handle: "robe", price: 1500, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.reviews).values({ id: "r1", storeId: "s1", productId: "p1", customerName: "Karim", rating: 5, body: "Très belle robe", status: "processing", verified: true, createdAt: T, updatedAt: T });
});

describe("preparing a review's files", () => {
  it("keeps a photo as WebP with its thumbnail, and a voice note as recorded, then lands the review", async () => {
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    const voice = await sent(id(2), fixture("voice.webm"), "audio", "audio/webm", 3300);
    const steps: string[] = [];
    expect(await run(job([photo, voice]), steps)).toEqual({ reviewId: "r1", landed: "attached", kept: 2, dropped: [] });
    expect(steps).toEqual(["prepare-0", "prepare-1", "attach-media", "clear-uploads"]);
    expect(imageCalls).toEqual([{ width: 1600, height: 1600, fit: "scale-down" }, { width: 480, height: 480, fit: "scale-down" }]);

    expect(await media()).toMatchObject([
      { id: id(1), kind: "image", r2Key: `reviews/r1/${id(1)}.webp`, thumbKey: `reviews/r1/${id(1)}-t.webp`, contentType: "image/webp", width: 64, height: 48, durationMs: null, position: 0 },
      { id: id(2), kind: "audio", r2Key: `reviews/r1/${id(2)}.webm`, thumbKey: null, contentType: "audio/webm", bytes: fixture("voice.webm").byteLength, durationMs: 3208, position: 1 },
    ]);
    expect(await review()).toMatchObject({ status: "pending", mediaDropped: 0 });

    const stored = await bucket.get(`reviews/r1/${id(1)}.webp`);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(fixture("photo-full.webp"));
    expect(stored!.httpMetadata).toMatchObject({ contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
    expect(await keys("reviews/")).toEqual([`reviews/r1/${id(1)}-t.webp`, `reviews/r1/${id(1)}.webp`, `reviews/r1/${id(2)}.webm`]);
    expect(await keys("review-uploads/")).toEqual([]);
  });

  it("never keeps a photo unconverted: without the image service it is dropped", async () => {
    imagesOn = false;
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    const voice = await sent(id(2), fixture("voice.ogg"), "audio", "audio/ogg");
    expect(await run(job([photo, voice]))).toMatchObject({ kept: 1, dropped: ["no_image_service"] });
    expect(await keys("reviews/")).toEqual([`reviews/r1/${id(2)}.ogg`]);
    expect(await review()).toMatchObject({ status: "pending", mediaDropped: 1 });
  });

  it("retries a passing failure of the image service, and keeps the photo", async () => {
    imageFailures = ["transient", "transient"];
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    expect(await run(job([photo]))).toMatchObject({ kept: 1, dropped: [] });
  });

  it("drops a file that can never be kept, and the review lands as text", async () => {
    imageFailures = ["bad"];
    const broken = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    const junk = await sent(id(2), new TextEncoder().encode("<svg/>"), "image", "image/svg+xml");
    expect(await run(job([broken, junk]))).toMatchObject({ kept: 0, dropped: ["unreadable", "unreadable"] });
    expect(await review()).toMatchObject({ status: "approved", mediaDropped: 2 });
    expect(await keys("reviews/")).toEqual([]);
    expect(await keys("review-uploads/")).toEqual([]);
  });

  it("drops a file the service keeps failing on, once retries run out", async () => {
    imageFailures = ["transient", "transient", "transient", "transient", "transient", "transient", "transient", "transient"];
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    expect(await run(job([photo]))).toMatchObject({ kept: 0, dropped: ["failed"] });
    expect(await review()).toMatchObject({ status: "approved", mediaDropped: 1 });
  });

  it("drops a voice note longer than the store allows, or one the store no longer takes", async () => {
    const long = await sent(id(1), fixture("voice-40s.ogg"), "audio", "audio/ogg");
    expect(await run(job([long]))).toMatchObject({ kept: 0, dropped: ["too_long"] });

    await d1.db.update(schema.reviews).set({ status: "processing" });
    const voice = await sent(id(2), fixture("voice.m4a"), "audio", "audio/mp4");
    expect(await run(job([voice], { voiceMaxSeconds: null }))).toMatchObject({ kept: 0, dropped: ["not_allowed"] });
  });

  it("shows the recorder's length only when the file does not say, and never above the limit", async () => {
    const fragmented = await sent(id(1), fixture("voice.mp3"), "audio", "audio/mpeg", 95_000);
    await run(job([fragmented]));
    expect((await media())[0]).toMatchObject({ kind: "audio", contentType: "audio/mpeg", durationMs: 30_000 });
  });

  it("changes nothing when a run repeats after landing", async () => {
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    await run(job([photo]));
    await bucket.put(photo.key, fixture("photo.jpg"), { customMetadata: { kind: "image", contentType: "image/jpeg" } });
    expect(await run(job([photo]))).toMatchObject({ landed: "attached" });
    expect(await media()).toHaveLength(1);
    expect(await keys("reviews/")).toEqual([`reviews/r1/${id(1)}-t.webp`, `reviews/r1/${id(1)}.webp`]);
  });

  it("takes the files back when the review was removed meanwhile", async () => {
    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    await d1.db.delete(schema.reviews);
    expect(await run(job([photo]))).toMatchObject({ landed: "gone" });
    expect(await keys("reviews/")).toEqual([]);
    expect(await keys("review-uploads/")).toEqual([]);
  });

  it("refuses a job that is not one", async () => {
    await expect(run({ reviewId: "r1", uploads: [{ key: "products/x.jpg", kind: "image", contentType: "image/jpeg", bytes: 3 }] } as never)).rejects.toThrow(/Invalid review media job/);
  });
});

describe("a review whose media job never finished", () => {
  it("is settled into the merchant's queue an hour later, and a late job then takes its files back", async () => {
    const now = Date.parse(T) + 61 * 60 * 1000;
    await d1.db.insert(schema.reviews).values({ id: "r2", storeId: "s1", productId: "p1", customerName: "Lina", rating: 4, body: "Joli", status: "processing", createdAt: new Date(now - 10 * 60 * 1000).toISOString(), updatedAt: T });
    await runStuckReviewSweep({ DB: d1.raw } as never, now);
    expect(await review()).toMatchObject({ status: "pending", mediaDropped: 1 });
    expect((await d1.db.select().from(schema.reviews).where(eq(schema.reviews.id, "r2")).get())?.status).toBe("processing");

    const photo = await sent(id(1), fixture("photo.jpg"), "image", "image/jpeg");
    expect(await run(job([photo]))).toMatchObject({ landed: "settled" });
    expect(await media()).toEqual([]);
    expect(await keys("reviews/")).toEqual([]);
  });
});
