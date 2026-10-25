import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const alger = { id: 16, name: "Alger", nameAr: "الجزائر" };
const oran = { id: 31, name: "Oran", nameAr: "وهران" };
const centre = { id: "16001", wilayaId: 16, name: "Alger Centre", nameAr: "الجزائر الوسطى", postalCode: "16000" };

beforeEach(() => {
  vi.resetModules();
  apiFetch.mockReset();
});

const load = () => import("./api");

describe("the wilayas and communes", () => {
  it("are read once a visit, by every screen that asks, even at the same moment", async () => {
    apiFetch.mockResolvedValue({ success: true, data: [alger, oran] });
    const { listWilayas } = await load();
    const [first, second] = await Promise.all([listWilayas(), listWilayas()]);
    expect(await listWilayas()).toEqual([alger, oran]);
    expect(first).toEqual([alger, oran]);
    expect(second).toEqual([alger, oran]);
    expect(apiFetch.mock.calls).toEqual([["/api/wilayas"]]);
  });

  it("are read again after a read that failed", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ success: true, data: [alger] });
    const { listWilayas } = await load();
    await expect(listWilayas()).rejects.toThrow("offline");
    expect(await listWilayas()).toEqual([alger]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("give each screen its own copy, so one sorting its list changes no other's", async () => {
    apiFetch.mockResolvedValue({ success: true, data: [oran, alger] });
    const { listWilayas } = await load();
    (await listWilayas()).sort((a, b) => a.id - b.id).pop();
    expect(await listWilayas()).toEqual([oran, alger]);
  });

  it("keep each wilaya's communes on their own", async () => {
    apiFetch.mockImplementation(async (path: string) => ({ success: true, data: path.endsWith("/16/communes") ? [centre] : [] }));
    const { listCommunes } = await load();
    expect(await listCommunes(16)).toEqual([centre]);
    expect(await listCommunes(31)).toEqual([]);
    expect(await listCommunes(16)).toEqual([centre]);
    expect(apiFetch.mock.calls).toEqual([["/api/wilayas/16/communes"], ["/api/wilayas/31/communes"]]);
  });
});
