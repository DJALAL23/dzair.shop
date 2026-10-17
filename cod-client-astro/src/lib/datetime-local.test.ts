import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./datetime-local";

describe("a schedule as the merchant's clock shows it", () => {
  it("round-trips an instant without moving it by the time zone", () => {
    for (const iso of ["2026-03-01T10:00:00.000Z", "2026-07-15T23:30:00.000Z"]) {
      expect(new Date(toLocalInput(iso)).toISOString()).toBe(iso);
      expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    }
  });

  it("is empty for no instant, and no instant for an empty input", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});
