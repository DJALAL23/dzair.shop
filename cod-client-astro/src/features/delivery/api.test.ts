import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: seam.apiFetch }));

import {
  createDriver,
  createDriverPayment,
  createShippingProfile,
  deleteCommuneOverride,
  deleteDriver,
  deleteDriverCompensation,
  deleteShippingProfile,
  getDriver,
  getShippingProfile,
  listDriverCompensations,
  listDriverPayments,
  listDrivers,
  listPendingSettlements,
  listShippingProfiles,
  listShippingRuleCommunes,
  retryWebhookEvent,
  syncCompanyShipments,
  setCommuneOverride,
  setDriverCompensation,
  setShippingRules,
  updateDriver,
  updateShippingProfile,
} from "./api";

describe("driver API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: [] });
  });

  it("always sends explicit pagination and encodes list filters", async () => {
    await listDrivers({ status: "available", search: "Ahmed", limit: 25, offset: 50 });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/drivers?limit=25&offset=50&status=available&search=Ahmed");
  });

  it("manages compensations and payments", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: [{ wilayaId: 16, feePerDelivery: 300 }] });
    await expect(listDriverCompensations("driver/1")).resolves.toEqual([{ wilayaId: 16, feePerDelivery: 300 }]);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/drivers/driver%2F1/compensations");
    await setDriverCompensation("driver/1", 16, 350);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/drivers/driver%2F1/compensations/16", expect.objectContaining({ method: "PUT", body: JSON.stringify({ feePerDelivery: 350 }) }));
    await deleteDriverCompensation("driver/1", 16);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/drivers/driver%2F1/compensations/16", { method: "DELETE" });
    await createDriverPayment({ driverId: "driver/1", type: "cod_remittance", shipmentIds: ["s1"], notes: "batch" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/driver-payments", expect.objectContaining({ method: "POST", body: JSON.stringify({ driverId: "driver/1", type: "cod_remittance", shipmentIds: ["s1"], notes: "batch" }) }));
    seam.apiFetch.mockResolvedValue({ success: true, data: [{ id: "p1" }] });
    await expect(listDriverPayments("driver/1")).resolves.toEqual([{ id: "p1" }]);
    await expect(listPendingSettlements("driver/1")).resolves.toEqual([{ id: "p1" }]);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/driver-payments/driver%2F1/pending");
  });

  it("unwraps the detail envelope", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { id: "driver/1" } });
    await expect(getDriver("driver/1")).resolves.toEqual({ id: "driver/1" });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/drivers/driver%2F1");
  });
});

describe("shipping profile API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: [] });
  });

  it("lists, reads, creates, updates and deletes profiles with URL-encoded IDs", async () => {
    await expect(listShippingProfiles()).resolves.toEqual([]);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/shipping-profiles");

    seam.apiFetch.mockResolvedValue({ success: true, data: { id: "profile/1", rules: [] } });
    await expect(getShippingProfile("profile/1")).resolves.toEqual({ id: "profile/1", rules: [] });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/shipping-profiles/profile%2F1");

    await createShippingProfile({ name: "Standard", isDefault: true });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Standard", isDefault: true }) }));

    await updateShippingProfile("profile/1", { name: "Rates" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles/profile%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Rates" }) }));

    await deleteShippingProfile("profile/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles/profile%2F1", { method: "DELETE" });
  });

  it("replaces rules and manages commune overrides", async () => {
    await setShippingRules("profile/1", [{ wilayaId: 16, homePrice: 400, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true }]);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles/profile%2F1/rules", expect.objectContaining({ method: "PUT", body: JSON.stringify({ rules: [{ wilayaId: 16, homePrice: 400, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true }] }) }));

    seam.apiFetch.mockResolvedValue({ success: true, data: [{ communeId: "c1", hasOverride: false }] });
    await expect(listShippingRuleCommunes("profile/1", 16)).resolves.toEqual([{ communeId: "c1", hasOverride: false }]);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/shipping-profiles/profile%2F1/rules/16/communes");

    await setCommuneOverride("profile/1", 16, "c1", { homePrice: 500 });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles/profile%2F1/rules/16/communes/c1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ homePrice: 500 }) }));

    await deleteCommuneOverride("profile/1", 16, "c1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipping-profiles/profile%2F1/rules/16/communes/c1", { method: "DELETE" });
  });
});

describe("carrier connection API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs a company's shipments now, and retries an inbox event", async () => {
    const summary = { synced: 12, recorded: 4, reached: 2, moreRemain: false };
    seam.apiFetch.mockResolvedValue({ success: true, data: summary });

    await expect(syncCompanyShipments("comp/1")).resolves.toEqual(summary);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/delivery-companies/comp%2F1/sync-shipments", { method: "POST" });
    await retryWebhookEvent("comp/1", "ev/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/delivery-companies/comp%2F1/webhook/events/ev%2F1/retry", { method: "POST" });
  });
});
