import { describe, it, expect } from "vitest";
import { carrierInstant } from "./time";

describe("carrierInstant", () => {
  it("reads Algiers wall-clock time as UTC+1", () => {
    expect(carrierInstant("2022-04-28 00:01:26")).toBe("2022-04-27T23:01:26.000Z");
    expect(carrierInstant("2026-10-14 13:00")).toBe("2026-10-14T12:00:00.000Z");
    expect(carrierInstant("2026-10-14")).toBe("2026-10-13T23:00:00.000Z");
    expect(carrierInstant("2026-09-10T08:15:00")).toBe("2026-09-10T07:15:00.000Z");
  });

  it("keeps UTC+1 in summer — Algeria has no daylight saving", () => {
    expect(carrierInstant("2026-07-01 12:00:00")).toBe("2026-07-01T11:00:00.000Z");
  });

  it("takes zoned values as they are", () => {
    expect(carrierInstant("2026-09-10T08:15:00Z")).toBe("2026-09-10T08:15:00.000Z");
    expect(carrierInstant("2026-09-10T08:15:00.5+02:00")).toBe("2026-09-10T06:15:00.500Z");
    expect(carrierInstant("2026-09-10T08:15:00.1234567+00:00")).toBe("2026-09-10T08:15:00.123Z");
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const bad of [null, undefined, "", "hier", "2026-02-30 10:00:00", "10/09/2026", "2026-13-01 10:00"]) {
      expect(carrierInstant(bad)).toBeNull();
    }
  });

  it("produces strings whose order is time order", () => {
    const a = carrierInstant("2026-10-14 09:59:59")!;
    const b = carrierInstant("2026-10-14 10:00:00")!;
    expect(a < b).toBe(true);
  });
});
