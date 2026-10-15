/**
 * Drivers — Unit Tests
 *
 * Coverage:
 *  1. Validation schemas (Zod) — no DB required
 *
 * The queries run against real D1: deleteDriver in
 * shipments/driver-handoff.e2e.test.ts, the driver's detail in
 * driver-payments/settlement.e2e.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  createDriverSchema,
  updateDriverSchema,
  updateDriverStatusSchema,
  driverFiltersSchema,
} from "./validation";

// ─── Validation ────────────────────────────────────────────────────────────────

describe("createDriverSchema", () => {
  const validBase = {
    firstName: "Ahmed",
    lastName: "Benali",
    phone: "0551234567",
  };

  it("accepts a valid driver payload", () => {
    expect(createDriverSchema.safeParse(validBase).success).toBe(true);
  });

  it("defaults status to 'available'", () => {
    expect(createDriverSchema.parse(validBase).status).toBe("available");
  });

  it("rejects empty firstName", () => {
    expect(createDriverSchema.safeParse({ ...validBase, firstName: "" }).success).toBe(false);
  });

  it("rejects empty lastName", () => {
    expect(createDriverSchema.safeParse({ ...validBase, lastName: "" }).success).toBe(false);
  });

  it("rejects missing phone", () => {
    const { phone: _, ...rest } = validBase;
    expect(createDriverSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects phone with wrong prefix (04...)", () => {
    expect(createDriverSchema.safeParse({ ...validBase, phone: "0421234567" }).success).toBe(false);
  });

  it("rejects phone that is too short", () => {
    expect(createDriverSchema.safeParse({ ...validBase, phone: "055123456" }).success).toBe(false);
  });

  it("rejects phone that is too long", () => {
    expect(createDriverSchema.safeParse({ ...validBase, phone: "05512345678" }).success).toBe(false);
  });

  it("accepts phone numbers starting with 05, 06, 07", () => {
    for (const phone of ["0551234567", "0661234567", "0771234567"]) {
      expect(createDriverSchema.safeParse({ ...validBase, phone }).success).toBe(true);
    }
  });

  it("accepts valid vehicle types", () => {
    for (const vehicleType of ["motorcycle", "car", "van"]) {
      expect(createDriverSchema.safeParse({ ...validBase, vehicleType }).success).toBe(true);
    }
  });

  it("rejects an invalid vehicle type", () => {
    expect(createDriverSchema.safeParse({ ...validBase, vehicleType: "truck" }).success).toBe(false);
  });

  it("rejects an invalid status value", () => {
    expect(createDriverSchema.safeParse({ ...validBase, status: "offline" }).success).toBe(false);
  });
});

describe("updateDriverSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(updateDriverSchema.safeParse({}).success).toBe(true);
  });

  it("rejects empty firstName if provided", () => {
    expect(updateDriverSchema.safeParse({ firstName: "" }).success).toBe(false);
  });

  it("accepts null phone2 to clear the second number", () => {
    expect(updateDriverSchema.safeParse({ phone2: null }).success).toBe(true);
  });

  it("rejects invalid phone2 format", () => {
    expect(updateDriverSchema.safeParse({ phone2: "0421234567" }).success).toBe(false);
  });
});

describe("updateDriverStatusSchema", () => {
  it.each(["available", "busy", "inactive"])("accepts status '%s'", (status) => {
    expect(updateDriverStatusSchema.safeParse({ status }).success).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(updateDriverStatusSchema.safeParse({ status: "offline" }).success).toBe(false);
  });
});

describe("driverFiltersSchema", () => {
  it("accepts valid filter combination", () => {
    const result = driverFiltersSchema.parse({ status: "available", vehicleType: "motorcycle" });
    expect(result.status).toBe("available");
  });

  it("coerces wilayaId from string to number", () => {
    expect(driverFiltersSchema.parse({ wilayaId: "16" }).wilayaId).toBe(16);
  });

  it("rejects wilayaId = 0", () => {
    expect(driverFiltersSchema.safeParse({ wilayaId: "0" }).success).toBe(false);
  });

  it("rejects wilayaId = 59", () => {
    expect(driverFiltersSchema.safeParse({ wilayaId: "59" }).success).toBe(false);
  });

  it("defaults limit to 50 and offset to 0", () => {
    const result = driverFiltersSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });
});
