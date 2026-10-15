import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchBlob: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: seam.apiFetch, apiFetchBlob: seam.apiFetchBlob }));

import {
  addRemark,
  askReturn,
  confirmReturn,
  getOrderStageCounts,
  handOffOrder,
  handOffToCarrier,
  handOffToDriver,
  listOrders,
  listRemarks,
  reportShipmentEvent,
  requestNewAttempt,
  resolveHandoff,
  setLineReturn,
  syncShipment,
  updateOrderStatus,
  updateParcel,
  validateShipment,
  voidShipment,
} from "./api";

const body = () => JSON.parse(seam.apiFetch.mock.lastCall![1].body);

describe("the orders API seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seam.apiFetch.mockResolvedValue({ success: true, data: [], nextCursor: null });
  });

  it("asks the server for a queue: several stages, the filters, a page", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: [{ id: "o1" }], count: 1, nextCursor: "c2" });
    const page = await listOrders({ stages: ["new", "unreachable"], attention: true, kind: "driver", orderType: "offline", wilayaId: 16, search: " 0551 ", limit: 25, cursor: "c1" });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/orders?limit=25&stage=new%2Cunreachable&attention=true&kind=driver&orderType=offline&wilayaId=16&search=0551&cursor=c1");
    expect(page).toEqual({ orders: [{ id: "o1" }], nextCursor: "c2" });
  });

  it("sends nothing it was not given", async () => {
    await listOrders();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/orders?limit=25");
  });

  it("reads the counts by stage", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { stages: [], needsAttention: 0 } });
    await expect(getOrderStageCounts()).resolves.toEqual({ stages: [], needsAttention: 0 });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/analytics/order-stages");
  });

  it("moves an order's status and records units refused at the door", async () => {
    await updateOrderStatus("o/1", "confirmed");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/o%2F1/status", expect.objectContaining({ method: "PATCH" }));
    expect(body()).toEqual({ status: "confirmed" });
    await setLineReturn("o/1", "l1", 2);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/o%2F1/products/l1/return", expect.objectContaining({ method: "PATCH" }));
    expect(body()).toEqual({ returnedQuantity: 2 });
  });

  it("hands orders off — one, or many to a carrier or a driver", async () => {
    await handOffOrder("o/1", { kind: "carrier", companyId: "yal", stationCode: "160101" });
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/orders/o%2F1/shipment", expect.objectContaining({ method: "POST" }));
    expect(body()).toEqual({ kind: "carrier", companyId: "yal", stationCode: "160101" });
    await handOffOrder("o1", { kind: "driver", driverId: "dr1" });
    expect(body()).toEqual({ kind: "driver", driverId: "dr1" });
    await handOffToCarrier("yal", ["o1", "o2"]);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipments/bulk", expect.objectContaining({ method: "POST" }));
    expect(body()).toEqual({ companyId: "yal", orderIds: ["o1", "o2"] });
    await handOffToDriver("dr1", ["o3"]);
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipments/driver-bulk", expect.objectContaining({ method: "POST" }));
    expect(body()).toEqual({ driverId: "dr1", orderIds: ["o3"] });
  });

  it("acts on a shipment at its own address", async () => {
    const calls: Array<[() => Promise<unknown>, string, string]> = [
      [() => validateShipment("s/1"), "/api/shipments/s%2F1/validate", "POST"],
      [() => updateParcel("s/1", { phone: "0551" }), "/api/shipments/s%2F1", "PATCH"],
      [() => voidShipment("s/1"), "/api/shipments/s%2F1/void", "POST"],
      [() => resolveHandoff("s/1", { action: "release" }), "/api/shipments/s%2F1/resolve", "POST"],
      [() => reportShipmentEvent("s/1", { status: "delivered" }), "/api/shipments/s%2F1/events", "POST"],
      [() => syncShipment("s/1"), "/api/shipments/s%2F1/sync", "POST"],
      [() => askReturn("s/1"), "/api/shipments/s%2F1/ask-return", "POST"],
      [() => requestNewAttempt("s/1"), "/api/shipments/s%2F1/request-new-attempt", "POST"],
      [() => confirmReturn("s/1"), "/api/shipments/s%2F1/confirm-return", "POST"],
      [() => addRemark("s/1", "Call first"), "/api/shipments/s%2F1/remarks", "POST"],
    ];
    for (const [call, path, method] of calls) {
      await call();
      expect(seam.apiFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method }));
    }
    await listRemarks("s/1");
    expect(seam.apiFetch).toHaveBeenLastCalledWith("/api/shipments/s%2F1/remarks");
  });

  it("resolves an unconfirmed handoff with the server's answer", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: { outcome: "not_found" } });
    await expect(resolveHandoff("s1", { action: "lookup" })).resolves.toEqual({ outcome: "not_found" });
    await resolveHandoff("s1", { action: "attach", trackingNumber: "YAL-1" });
    expect(body()).toEqual({ action: "attach", trackingNumber: "YAL-1" });
  });
});
