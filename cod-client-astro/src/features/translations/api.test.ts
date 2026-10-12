import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => seam);

import { getTranslations, saveTranslations } from "./api";

describe("translation API adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: { id: "p-1" } });
  });

  it("reads through the resource's own route and unwraps the envelope", async () => {
    await expect(getTranslations("offer", "o/1")).resolves.toEqual({ id: "p-1" });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/offers/o%2F1/translations");
  });

  it("saves one language as a JSON merge patch", async () => {
    await saveTranslations("product", "p-1", { locale: "fr", values: { name: "Téléphone", description: null } });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/products/p-1/translations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "fr", values: { name: "Téléphone", description: null } }),
    });
  });
});
