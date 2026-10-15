/**
 * When CodFlow starts a CAPI workflow — and that starting one never breaks
 * the request that caused it.
 */
import { describe, it, expect, vi } from "vitest";
import { getCapiWorkflowId } from "@/workflows/capi-helpers";
import { scheduleStatusConversion, startCapiWorkflow } from "./conversions";

function workflow(create = vi.fn(async (_: unknown) => ({ id: "wf" }))) {
  const started: Promise<unknown>[] = [];
  return { env: { CAPI_WORKFLOW: { create } } as never, create, waitUntil: (p: Promise<unknown>) => void started.push(p), started };
}

describe("an order status change", () => {
  it("confirmed starts the confirmed stage", () => {
    const w = workflow();
    expect(scheduleStatusConversion(w.env, w.waitUntil, { id: "o1", wilayaId: 16 }, "confirmed")).toBe(true);
    expect(w.create).toHaveBeenCalledWith({
      id: getCapiWorkflowId("o1", "confirmed", "Purchase"),
      params: expect.objectContaining({ orderId: "o1", stage: "confirmed", eventName: "Purchase", triggerStatus: "confirmed" }),
    });
  });

  it("delivered starts the delivered stage anywhere; out for delivery only in a long-haul wilaya", () => {
    const w = workflow();
    expect(scheduleStatusConversion(w.env, w.waitUntil, { id: "o1", wilayaId: 16 }, "delivered")).toBe(true);
    expect(scheduleStatusConversion(w.env, w.waitUntil, { id: "o2", wilayaId: 16 }, "out_for_delivery")).toBe(false);
    expect(scheduleStatusConversion(w.env, w.waitUntil, { id: "o3", wilayaId: 11 }, "out_for_delivery")).toBe(true);
    expect(w.create.mock.calls.map(([c]) => (c as { params: { orderId: string; stage: string } }).params)).toEqual([
      expect.objectContaining({ orderId: "o1", stage: "delivered" }),
      expect.objectContaining({ orderId: "o3", stage: "delivered", triggerStatus: "out_for_delivery" }),
    ]);
  });

  it("other statuses start nothing", () => {
    const w = workflow();
    for (const status of ["new", "preparing", "ready", "cancelled", "returned"]) {
      expect(scheduleStatusConversion(w.env, w.waitUntil, { id: "o1", wilayaId: 1 }, status)).toBe(false);
    }
    expect(w.create).not.toHaveBeenCalled();
  });
});

describe("starting a workflow", () => {
  it("is kept alive past the response, and a failure to start never throws", async () => {
    const w = workflow(vi.fn(async () => {
      throw new Error("instance already exists");
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    startCapiWorkflow(w.env, w.waitUntil, { orderId: "o1", eventName: "Purchase", stage: "delivered", trigger: "delivered" });
    expect(w.started).toHaveLength(1);
    await expect(Promise.all(w.started)).resolves.toBeDefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("without the binding nothing is started and nothing throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const started: unknown[] = [];
    startCapiWorkflow({} as never, (p) => void started.push(p), { orderId: "o1", eventName: "Purchase", stage: "confirmed", trigger: "confirmed" });
    expect(started).toHaveLength(0);
    error.mockRestore();
  });

  it("passes the page the order came from, when known", () => {
    const w = workflow();
    startCapiWorkflow(w.env, w.waitUntil, { orderId: "o1", eventName: "Lead", stage: "checkout", trigger: "order_created", eventSourceUrl: "https://shop.dz/p/robe" });
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { eventSourceUrl: "https://shop.dz/p/robe", eventName: "Lead", stage: "checkout" } });
  });
});
