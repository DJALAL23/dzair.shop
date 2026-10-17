import { describe, expect, it } from "vitest";
import { offerState } from "./model";

describe("offerState", () => {
  const NOW = "2026-11-10T12:00:00.000Z";
  const at = (extra: Partial<Parameters<typeof offerState>[0]> = {}) => ({ status: "active" as const, startsAt: null, endsAt: null, ...extra });

  it("is live when active, started and not ended", () => {
    expect(offerState(at(), NOW)).toBe("live");
    expect(offerState(at({ startsAt: NOW, endsAt: "2026-11-10T12:00:00.001Z" }), NOW)).toBe("live");
  });

  it("says why it is not, the merchant's switch first", () => {
    expect(offerState(at({ status: "inactive", endsAt: "2026-01-01T00:00:00.000Z" }), NOW)).toBe("inactive");
    expect(offerState(at({ startsAt: "2026-11-10T12:00:00.001Z" }), NOW)).toBe("scheduled");
    expect(offerState(at({ endsAt: NOW }), NOW)).toBe("expired");
  });
});
