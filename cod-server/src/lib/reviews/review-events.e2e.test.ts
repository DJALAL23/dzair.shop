/**
 * A customer's review told to the store's integrations (`review.submitted`),
 * on real D1: once, when it reaches the store — at once without files, or
 * when its files are ready or given up on — carrying the review and its
 * order as they were; never for a review still being prepared, a second
 * landing, or a review the store entered itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { toBusinessEvent, type BusinessEvent } from "../../../../cod-shared/events/log";
import { insertShopperReview } from "../../../../cod-shared/queries/store-reviews";
import { insertStoreReview, settleStuckReviews, settleWithoutMedia } from "../../../../cod-shared/queries/reviews";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";
import { attachMedia } from "@/lib/review-media/prepare";

let d1: TestD1;
const T = "2026-11-10T08:00:00.000Z";
const ORDER = { id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "Amel" };
const LIBRARY = { release: async (keys: readonly string[]) => ({ released: [...keys], kept: [] }) };

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "review_media", "reviews", "media", "order_products", "orders", "products", "customers", "users", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Boutique", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values({ id: "p1", name: "Robe kabyle", handle: "robe", price: 4500, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.orders).values({ id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "Amel", phone: "0551234567", price: 4500, deliveryFee: 400, codAmount: 4900, status: "ready", createdAt: T, updatedAt: T });
});

async function told(): Promise<BusinessEvent[]> {
  const rows = await d1.db.select().from(schema.businessEvents).orderBy(asc(schema.businessEvents.seq)).all();
  const events = rows.map(toBusinessEvent);
  for (const event of events) expect(BUSINESS_EVENT_SCHEMA.safeParse(event).error, event.type).toBeUndefined();
  return events;
}

const shopperReview = (status: "processing" | "pending" | "approved", fields: { title?: string | null; body?: string; verified?: boolean } = {}) =>
  insertShopperReview(d1.db, { storeId: "s1", productId: "p1", order: ORDER, rating: 4, title: "title" in fields ? (fields.title ?? null) : "Très belle", body: fields.body ?? "Le tissu est beau.", status, verified: fields.verified ?? true });
const statusOf = async (id: string) => (await d1.db.select({ status: schema.reviews.status }).from(schema.reviews).where(eq(schema.reviews.id, id)).get())!.status;

describe("a customer's review, told to the store's integrations", () => {
  it("is told at once when it comes without files, with the review and its order, as the customer's, on the store", async () => {
    const inserted = await shopperReview("pending");
    if (!inserted.ok) throw new Error("not inserted");
    const [event, ...rest] = await told();
    expect(rest).toEqual([]);
    const createdAt = (await d1.db.select({ at: schema.reviews.createdAt }).from(schema.reviews).get())!.at;
    expect(event).toMatchObject({
      type: "review.submitted",
      subject: { type: "review", id: inserted.id },
      orderId: "o1",
      occurredAt: createdAt,
      actor: { kind: "shopper", id: null, name: null },
      origin: "storefront",
      data: {
        review: { id: inserted.id, product: { id: "p1", name: "Robe kabyle" }, rating: 4, title: "Très belle", body: "Le tissu est beau.", status: "pending", verified: true, customerName: "Amel", photos: 0, voiceNote: false, submittedAt: createdAt },
        order: { id: "o1", number: "ORD-1", status: "ready" },
      },
    });
  });

  it("says a review the store publishes at once is on the store", async () => {
    await shopperReview("approved", { title: null, verified: false });
    expect((await told())[0]!.data).toMatchObject({ review: { status: "approved", title: null, verified: false } });
  });

  it("is not told twice when the same product of the order is reviewed twice", async () => {
    await shopperReview("pending");
    expect(await shopperReview("pending")).toEqual({ ok: false, reason: "already_reviewed" });
    expect(await told()).toHaveLength(1);
  });

  it("waits for its files, then is told once with how many photos and whether a voice note came", async () => {
    const inserted = await shopperReview("processing", { body: "" });
    if (!inserted.ok) throw new Error("not inserted");
    expect(await told()).toEqual([]);
    const submittedAt = "2026-11-10T09:15:00.000Z";
    await d1.db.update(schema.reviews).set({ createdAt: submittedAt, updatedAt: submittedAt });
    const kept = (id: string, kind: "image" | "audio", mediaKey: string, thumbKey: string | null) => ({ kept: true as const, media: { id, kind, mediaKey, thumbKey, contentType: kind === "image" ? "image/webp" : "audio/webm", bytes: 10, width: null, height: null, durationMs: null } });
    const job = { reviewId: inserted.id, uploads: [], voiceMaxSeconds: 30, statusWithMedia: "pending" as const, statusWithoutMedia: "approved" as const };
    const outcomes = [kept("m1", "image", "reviews/r/a.webp", "reviews/r/a-t.webp"), kept("m2", "image", "reviews/r/b.webp", "reviews/r/b-t.webp"), kept("m3", "audio", "reviews/r/v.webm", null)];
    expect(await attachMedia(d1.db, LIBRARY, job, outcomes)).toBe("attached");
    expect(await attachMedia(d1.db, LIBRARY, job, outcomes)).toBe("attached");
    const events = await told();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ occurredAt: submittedAt, data: { review: { status: "pending", photos: 2, voiceNote: true, body: "", submittedAt } } });
  });

  it("is told once when its files are given up on, as it lands without them", async () => {
    const inserted = await shopperReview("processing");
    if (!inserted.ok) throw new Error("not inserted");
    await attachMedia(d1.db, LIBRARY, { reviewId: inserted.id, uploads: [], voiceMaxSeconds: 30, statusWithMedia: "pending", statusWithoutMedia: "approved" }, [{ kept: false, reason: "unreadable" }]);
    expect((await told()).map((event) => event.data)).toMatchObject([{ review: { status: "approved", photos: 0, voiceNote: false } }]);
  });

  it("counts a photo without taking it for a voice note", async () => {
    const inserted = await shopperReview("processing");
    if (!inserted.ok) throw new Error("not inserted");
    const photo = { kept: true as const, media: { id: "m1", kind: "image" as const, mediaKey: "reviews/r/a.webp", thumbKey: "reviews/r/a-t.webp", contentType: "image/webp", bytes: 10, width: 64, height: 48, durationMs: null } };
    await attachMedia(d1.db, LIBRARY, { reviewId: inserted.id, uploads: [], voiceMaxSeconds: 30, statusWithMedia: "pending", statusWithoutMedia: "approved" }, [photo, { kept: false, reason: "too_long" }]);
    expect((await told()).map((event) => event.data)).toMatchObject([{ review: { status: "pending", photos: 1, voiceNote: false } }]);
  });

  it("is told once when the sweep settles it while its files are being kept", async () => {
    const inserted = await shopperReview("processing");
    if (!inserted.ok) throw new Error("not inserted");
    let raced = false;
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch" && !raced) {
          return async (statements: unknown[]) => {
            raced = true;
            await settleWithoutMedia(target, inserted.id, { status: "pending", dropped: 1 });
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await attachMedia(racing as typeof d1.db, LIBRARY, { reviewId: inserted.id, uploads: [], voiceMaxSeconds: 30, statusWithMedia: "pending", statusWithoutMedia: "approved" }, [{ kept: false, reason: "unreadable" }]);
    expect(await told()).toHaveLength(1);
  });

  it("is told once when its files land while the sweep settles it", async () => {
    const inserted = await shopperReview("processing");
    if (!inserted.ok) throw new Error("not inserted");
    await d1.db.update(schema.reviews).set({ createdAt: "2026-11-10T07:00:00.000Z" });
    let raced = false;
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch" && !raced) {
          return async (statements: unknown[]) => {
            raced = true;
            await settleWithoutMedia(target, inserted.id, { status: "approved", dropped: 0 });
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(await settleStuckReviews(racing as typeof d1.db, "2026-11-10T07:30:00.000Z")).toBe(0);
    expect(await told()).toHaveLength(1);
  });

  it("is told once when its files never started, and settling it again tells nothing", async () => {
    const inserted = await shopperReview("processing");
    if (!inserted.ok) throw new Error("not inserted");
    await settleWithoutMedia(d1.db, inserted.id, { status: "pending", dropped: 1 });
    await settleWithoutMedia(d1.db, inserted.id, { status: "approved", dropped: 1 });
    expect(await statusOf(inserted.id)).toBe("pending");
    expect((await told()).map((event) => event.data)).toMatchObject([{ review: { status: "pending" } }]);
  });

  it("is told for each review the sweep settles, and only for those", async () => {
    const stuck = await Promise.all(["p1"].map(() => shopperReview("processing")));
    await d1.db.insert(schema.products).values({ id: "p2", name: "Foulard", handle: "foulard", price: 900, createdAt: T, updatedAt: T });
    const fresh = await insertShopperReview(d1.db, { storeId: "s1", productId: "p2", order: ORDER, rating: 5, title: null, body: "Bien.", status: "processing", verified: true });
    await d1.db.update(schema.reviews).set({ createdAt: "2026-11-10T07:00:00.000Z" }).where(eq(schema.reviews.productId, "p1"));
    expect(await settleStuckReviews(d1.db, "2026-11-10T07:30:00.000Z")).toBe(1);
    expect(await settleStuckReviews(d1.db, "2026-11-10T07:30:00.000Z")).toBe(0);
    const events = await told();
    expect(events.map((event) => event.subject.id)).toEqual(stuck.map((r) => (r.ok ? r.id : null)));
    expect(fresh.ok && (await statusOf(fresh.id))).toBe("processing");
  });

  it("is never told for a review the store entered itself", async () => {
    await insertStoreReview(d1.db, { storeId: "s1", productId: "p1", customerId: "c1", customerName: "Amel", order: { id: "o1", orderNumber: "ORD-1", delivered: true }, rating: 5, title: null, body: "Cliente fidèle.", status: "approved", createdBy: "u1" });
    const pending = await insertStoreReview(d1.db, { storeId: "s1", productId: "p1", customerId: null, customerName: "Lina", order: null, rating: 4, title: null, body: "Par téléphone.", status: "processing", createdBy: "u1" });
    if (pending.ok) await settleWithoutMedia(d1.db, pending.id, { status: "pending", dropped: 1 });
    expect(await told()).toEqual([]);
  });

  it("is never told for a review the store entered on a customer's order, when its files land or are given up on", async () => {
    await d1.db.insert(schema.products).values({ id: "p2", name: "Foulard", handle: "foulard", price: 900, createdAt: T, updatedAt: T });
    const withFiles = await insertStoreReview(d1.db, { storeId: "s1", productId: "p1", customerId: "c1", customerName: "Amel", order: { id: "o1", orderNumber: "ORD-1", delivered: true }, rating: 5, title: null, body: "Par WhatsApp.", status: "processing", createdBy: "u1" });
    const filesLost = await insertStoreReview(d1.db, { storeId: "s1", productId: "p2", customerId: "c1", customerName: "Amel", order: { id: "o1", orderNumber: "ORD-1", delivered: true }, rating: 4, title: null, body: "Par téléphone.", status: "processing", createdBy: "u1" });
    if (!withFiles.ok || !filesLost.ok) throw new Error("not inserted");
    const photo = { kept: true as const, media: { id: "m1", kind: "image" as const, mediaKey: "reviews/s/a.webp", thumbKey: "reviews/s/a-t.webp", contentType: "image/webp", bytes: 10, width: 64, height: 48, durationMs: null } };
    expect(await attachMedia(d1.db, LIBRARY, { reviewId: withFiles.id, uploads: [], voiceMaxSeconds: 30, statusWithMedia: "approved", statusWithoutMedia: "approved" }, [photo])).toBe("attached");
    await settleWithoutMedia(d1.db, filesLost.id, { status: "approved", dropped: 1 });
    expect([await statusOf(withFiles.id), await statusOf(filesLost.id)]).toEqual(["approved", "approved"]);
    expect(await told()).toEqual([]);
  });
});
