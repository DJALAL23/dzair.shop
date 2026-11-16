/**
 * A customer's review told to the store's integrations (`review.submitted`),
 * on real D1: once, in the write that records the review with its files,
 * carrying the review and its order as they were; never for a second review
 * of the same product, a review whose file another took, or a review the
 * store entered itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { toBusinessEvent, type BusinessEvent } from "../../../../cod-shared/events/log";
import { insertShopperReview } from "../../../../cod-shared/queries/store-reviews";
import { insertStoreReview } from "../../../../cod-shared/queries/reviews";
import type { ReviewFile } from "../../../../cod-shared/queries/review-uploads";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";

let d1: TestD1;
const T = "2026-11-10T08:00:00.000Z";
const ORDER = { id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "Amel" };

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "review_media", "reviews", "media", "order_products", "orders", "products", "customers", "users", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Boutique", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values({ id: "p1", name: "Robe kabyle", handle: "robe", price: 4500, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values({ id: "p2", name: "Foulard", handle: "foulard", price: 900, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.orders).values({ id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "Amel", phone: "0551234567", price: 4500, deliveryFee: 400, codAmount: 4900, status: "ready", createdAt: T, updatedAt: T });
});

async function told(): Promise<BusinessEvent[]> {
  const rows = await d1.db.select().from(schema.businessEvents).orderBy(asc(schema.businessEvents.seq)).all();
  const events = rows.map(toBusinessEvent);
  for (const event of events) expect(BUSINESS_EVENT_SCHEMA.safeParse(event).error, event.type).toBeUndefined();
  return events;
}

const photo = (id: string): ReviewFile => ({ id, kind: "image", mediaKey: `reviews/g/${id}.webp`, thumbKey: `reviews/g/${id}-t.webp`, contentType: "image/webp", bytes: 10, width: 64, height: 48, durationMs: null });
const voice = (id: string): ReviewFile => ({ id, kind: "audio", mediaKey: `reviews/g/${id}.webm`, thumbKey: null, contentType: "audio/webm", bytes: 10, width: null, height: null, durationMs: 12_000 });

const shopperReview = (status: "pending" | "approved", fields: { title?: string | null; body?: string; verified?: boolean; productId?: string; files?: ReviewFile[] } = {}) =>
  insertShopperReview(d1.db, { storeId: "s1", productId: fields.productId ?? "p1", order: ORDER, rating: 4, title: "title" in fields ? (fields.title ?? null) : "Très belle", body: fields.body ?? "Le tissu est beau.", status, verified: fields.verified ?? true, files: fields.files ?? [] });
const filesOf = async (id: string) => d1.db.select({ id: schema.reviewMedia.id, position: schema.reviewMedia.position, durationMs: schema.reviewMedia.durationMs }).from(schema.reviewMedia).where(eq(schema.reviewMedia.reviewId, id)).orderBy(asc(schema.reviewMedia.position)).all();

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

  it("is told once, with its files written in the same write, counting the photos and the voice note", async () => {
    const inserted = await shopperReview("pending", { body: "", files: [photo("a"), photo("b"), voice("v")] });
    if (!inserted.ok) throw new Error("not inserted");
    expect(await filesOf(inserted.id)).toEqual([
      { id: "a", position: 0, durationMs: null },
      { id: "b", position: 1, durationMs: null },
      { id: "v", position: 2, durationMs: 12_000 },
    ]);
    const events = await told();
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ review: { status: "pending", photos: 2, voiceNote: true, body: "" } });
  });

  it("counts a photo without taking it for a voice note", async () => {
    await shopperReview("pending", { files: [photo("a")] });
    expect((await told()).map((event) => event.data)).toMatchObject([{ review: { photos: 1, voiceNote: false } }]);
  });

  it("writes nothing and tells nothing when another review already took one of its files", async () => {
    const first = await shopperReview("pending", { files: [photo("a")] });
    const second = await shopperReview("pending", { productId: "p2", files: [photo("b"), photo("a")] });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "upload_taken" });
    expect(await d1.db.select({ id: schema.reviews.id }).from(schema.reviews).all()).toHaveLength(1);
    expect(await d1.db.select({ id: schema.reviewMedia.id }).from(schema.reviewMedia).all()).toEqual([{ id: "a" }]);
    expect(await told()).toHaveLength(1);
  });

  it("is never told for a review the store entered itself, with files or without, on a customer's order or none", async () => {
    const withFiles = await insertStoreReview(d1.db, { storeId: "s1", productId: "p1", customerId: "c1", customerName: "Amel", order: { id: "o1", orderNumber: "ORD-1", delivered: true }, rating: 5, title: null, body: "Par WhatsApp.", status: "approved", createdBy: "u1", files: [photo("a"), voice("v")] });
    const plain = await insertStoreReview(d1.db, { storeId: "s1", productId: "p2", customerId: null, customerName: "Lina", order: null, rating: 4, title: null, body: "Par téléphone.", status: "pending", createdBy: "u1", files: [] });
    if (!withFiles.ok || !plain.ok) throw new Error("not inserted");
    expect((await filesOf(withFiles.id)).map((file) => file.id)).toEqual(["a", "v"]);
    expect(await told()).toEqual([]);
  });

  it("is refused whole, files and all, when the store's review takes a file another review shows", async () => {
    await shopperReview("pending", { files: [photo("a")] });
    const taken = await insertStoreReview(d1.db, { storeId: "s1", productId: "p2", customerId: null, customerName: "Lina", order: null, rating: 4, title: null, body: "Par téléphone.", status: "pending", createdBy: "u1", files: [photo("a")] });
    expect(taken).toEqual({ ok: false, reason: "upload_taken" });
    expect(await d1.db.select({ id: schema.reviews.id }).from(schema.reviews).all()).toHaveLength(1);
  });
});
