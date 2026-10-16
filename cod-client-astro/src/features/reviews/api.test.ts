import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { createStoreReview, deleteReview, deleteReviewMedia, listReviewOrderOptions, listReviews, updateReviewStatus, uploadReviewFile } from "./api";

describe("review API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: [], total: 0, pendingCount: 0 });
  });

  it("always sends explicit pagination and encodes status filters", async () => {
    await listReviews({ status: "pending", limit: 20, offset: 40 });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/reviews?limit=20&offset=40&status=pending");
  });

  it("unwraps the list envelope into rows/total/pendingCount", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: [{ id: "rev-1" }], total: 7, pendingCount: 2 });
    await expect(listReviews({})).resolves.toEqual({ rows: [{ id: "rev-1" }], total: 7, pendingCount: 2 });
  });

  it("updates review status and deletes with URL-encoded ids", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { id: "rev/1", status: "approved" } });
    await updateReviewStatus("rev/1", "approved");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews/rev%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "approved" }) }));
    await deleteReview("rev/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews/rev%2F1", { method: "DELETE" });
  });
});

describe("review API adapters — media and store reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: {} });
  });

  it("filters by who entered a review and by media", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: [], total: 0, pendingCount: 0 });
    await listReviews({ source: "merchant", withMedia: true, limit: 20, offset: 0 });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/reviews?limit=20&offset=0&source=merchant&withMedia=true");
  });

  it("sends a file as it is, with the recorder's length for a voice note", async () => {
    const file = new Blob(["x"], { type: "audio/ogg" });
    await uploadReviewFile(file, 15_400.7);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/reviews/uploads", {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream", "X-Media-Duration-Ms": "15401" },
    });
    await uploadReviewFile(new Blob(["y"]));
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews/uploads", expect.objectContaining({ headers: { "Content-Type": "application/octet-stream" } }));
  });

  it("creates a store review, removes one file, and lists a customer's orders for a product", async () => {
    await createStoreReview({ productId: "p1", customerId: "c1", rating: 5, body: "Très bien", publish: false });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews", expect.objectContaining({ method: "POST", body: JSON.stringify({ productId: "p1", customerId: "c1", rating: 5, body: "Très bien", publish: false }) }));
    await deleteReviewMedia("r/1", "m 1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews/r%2F1/media/m%201", { method: "DELETE" });
    await listReviewOrderOptions("c1", "p&1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/reviews/order-options?customerId=c1&productId=p%261");
  });
});
