/**
 * getStoreProducts — Slice 5 mock-queue coverage.
 *
 * Call shape: ONE main select (products + review subqueries), then ONE read
 * batch containing the cover-image select(s) and active-variant inventory
 * aggregate(s). No per-row queries.
 */

import { describe, it, expect } from "vitest";
import { makeMockDb, a, productRow } from "@/test-utils/mock-db";
import { getStoreProducts } from "../../../../cod-shared/queries/store";
import { TEST_DELIVERY } from "@/test-utils/media";

/** The listing's product row: its public columns in the select's order, then the review aggregates — the mock db maps a select by position. */
function listedRow(overrides: Record<string, unknown>, review: { avg_rating: number | null; review_count: number }) {
  const { cost_price: _cost, visibility: _v, status: _s, show_in_store: _shown, published_at: _p, shipping_profile_id: _ship, created_at: _c, updated_at: _u, meta_title, meta_description, ...rest } = productRow(overrides);
  return { ...rest, meta_title, meta_description, ...review };
}

/** A product_images row, its columns in schema order: the mock db maps a full-table select by position. */
function imageRow(id: string, mediaKey: string, position: number) {
  const at = "2024-01-01T00:00:00.000Z";
  return { id, product_id: "prod_1", alt_text: null, width: null, height: null, type: 1, position, created_at: at, updated_at: at, media_key: mediaKey };
}

describe("getStoreProducts", () => {
  it("maps cover image, variant inventory, and review stats from one batch", async () => {
    const db = makeMockDb([
      a([
        listedRow({ has_variants: 1, inventory: 999 }, { avg_rating: 4.7, review_count: 12 }),
      ]),
      a([imageRow("img_1", "products/cover.jpg", 2)]),
      a([{ productId: "prod_1", total: 14 }]),
    ]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "prod_1",
      inventory: 14,
      reviewStats: { avgRating: 4.7, reviewCount: 12 },
    });
    expect(rows[0].coverImage).toMatchObject({ id: "img_1", key: "products/cover.jpg", url: `${TEST_DELIVERY.origin}/products/cover.jpg` });
  });

  it("picks the first cover image by position within a product", async () => {
    const db = makeMockDb([
      a([listedRow({}, { avg_rating: null, review_count: 0 })]),
      a([
        imageRow("img_b", "products/first.jpg", 1),
        imageRow("img_a", "products/second.jpg", 2),
      ]),
      a([]),
    ]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows[0].coverImage).toMatchObject({ id: "img_b", key: "products/first.jpg" });
  });

  it("simple product inventory comes from the product row (no variant sum)", async () => {
    const db = makeMockDb([
      a([listedRow({ inventory: 42, has_variants: 0 }, { avg_rating: null, review_count: 0 })]),
      a([]),
      a([]),
    ]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows[0]).toMatchObject({ inventory: 42, coverImage: null });
  });

  it("variant product with no active variants maps inventory 0", async () => {
    const db = makeMockDb([
      a([listedRow({ has_variants: 1, inventory: 999 }, { avg_rating: null, review_count: 0 })]),
      a([]),
      a([]),
    ]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows[0]).toMatchObject({ inventory: 0 });
  });

  it("null reviewStats when no approved reviews", async () => {
    const db = makeMockDb([
      a([listedRow({}, { avg_rating: null, review_count: 0 })]),
      a([]),
      a([]),
    ]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows[0].reviewStats).toBeNull();
  });

  it("returns [] for an empty page without the follow-up batch", async () => {
    const db = makeMockDb([a([])]);

    const rows = await getStoreProducts(db, {}, null, TEST_DELIVERY);

    expect(rows).toEqual([]);
  });
});
