/**
 * The worker's schedule: the five-minute trigger runs the delivery pipeline
 * and nothing else; the hourly trigger keeps its own jobs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const jobs = vi.hoisted(() => ({
  inbound: vi.fn(async () => {}),
  abandoned: vi.fn(async () => {}),
  images: vi.fn(async () => {}),
  places: vi.fn(async () => {}),
}));
vi.mock("@/inbound/cron", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/inbound/cron")>()),
  runInboundCron: jobs.inbound,
}));
vi.mock("@/cron/sweep-abandoned-orders", () => ({ sweepAbandonedOrders: jobs.abandoned }));
vi.mock("@/cron/media-sweep", () => ({ runMediaSweep: jobs.images }));
vi.mock("@/cron/refresh-carrier-places", () => ({ refreshCarrierPlaces: jobs.places }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class {
    fetch() {
      return new Response("ok");
    }
    async purgeExpiredData() {}
  },
}));

import worker from "./index";
import { INBOUND_CRON } from "@/inbound/cron";

const run = (cron: string) => {
  const started: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void started.push(p.catch(() => undefined)), passThroughOnException() {} };
  return worker.scheduled!({ cron, scheduledTime: Date.now(), type: "scheduled" } as never, { WORKER_SELF_URL: "https://api.example.dz" } as never, ctx as never).then(() => started);
};

beforeEach(() => {
  for (const job of Object.values(jobs)) job.mockClear();
});

describe("the worker's schedule", () => {
  it("every five minutes: the delivery pipeline only", async () => {
    await run(INBOUND_CRON);
    expect(jobs.inbound).toHaveBeenCalledTimes(1);
    expect(jobs.abandoned).not.toHaveBeenCalled();
    expect(jobs.images).not.toHaveBeenCalled();
    expect(jobs.places).not.toHaveBeenCalled();
  });

  it("every hour: the hourly jobs, not the pipeline", async () => {
    await run("0 * * * *");
    expect(jobs.abandoned).toHaveBeenCalledTimes(1);
    expect(jobs.images).toHaveBeenCalledTimes(1);
    expect(jobs.places).toHaveBeenCalledTimes(1);
    expect(jobs.inbound).not.toHaveBeenCalled();
  });
});
