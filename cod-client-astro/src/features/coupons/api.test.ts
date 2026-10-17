import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { createCoupon, deleteCoupon, getCoupon, listCoupons, updateCoupon } from "./api";

describe("coupon API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: { id: "c/1" } });
  });

  it("lists and reads coupons, unwrapping the envelope", async () => {
    seam.apiFetch.mockResolvedValueOnce({ success: true, data: [{ id: "c/1" }] });
    await expect(listCoupons()).resolves.toEqual([{ id: "c/1" }]);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/coupons");
    await expect(getCoupon("c/1")).resolves.toEqual({ id: "c/1" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/coupons/c%2F1");
  });

  it("writes through the coupon routes and URL-encodes ids", async () => {
    await expect(createCoupon({ code: "SALE10", kind: "percentage", value: 10, scope: "store", productIds: [], collectionIds: [], audience: "everyone", customerIds: [], groupIds: [], oncePerCustomer: false, status: "active" })).resolves.toEqual({ id: "c/1" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/coupons", expect.objectContaining({ method: "POST", body: expect.stringContaining('"code":"SALE10"') }));
    await updateCoupon("c/1", { status: "inactive" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/coupons/c%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "inactive" }) }));
    await deleteCoupon("c/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/coupons/c%2F1", { method: "DELETE" });
  });
});
