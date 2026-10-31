import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: seam.apiFetch }));

import { getMyStore, updateMyStore } from "./api";

describe("settings API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps the store config detail envelope", async () => {
    const store = { id: "store-1", name: "My Store" };
    seam.apiFetch.mockResolvedValue({ success: true, data: store });
    await expect(getMyStore()).resolves.toEqual(store);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/stores/me");
  });

  it("patches the store and unwraps the updated config", async () => {
    const store = { id: "store-1", name: "Renamed" };
    seam.apiFetch.mockResolvedValue({ success: true, data: store });
    await expect(updateMyStore({ name: "Renamed", cartEnabled: true })).resolves.toEqual(store);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/stores/me", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Renamed", cartEnabled: true }) }));
  });
});
