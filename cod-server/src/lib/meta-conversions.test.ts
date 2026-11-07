import { describe, it, expect } from "vitest";
import {
  isLongHaulWilaya,
  resolveCapiDispatch,
  resolveConversionForStage,
  type CapiDispatchConfig,
  type ConversionMode,
  type ConversionStage,
} from "./meta-conversions";

describe("Conversion Model — resolveConversionForStage", () => {
  describe("Mode: Purchase (Instant Checkout)", () => {
    const mode: ConversionMode = "Purchase";

    it("fires Purchase at checkout", () => {
      const res = resolveConversionForStage(mode, "checkout");
      expect(res).toEqual({
        shouldFire: true,
        eventName: "Purchase",
        stage: "checkout",
      });
    });

    it("skips at confirmed stage", () => {
      const res = resolveConversionForStage(mode, "confirmed");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase");
    });

    it("skips at delivered stage", () => {
      const res = resolveConversionForStage(mode, "delivered");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase");
    });
  });

  describe("Mode: Purchase_Confirmed (Phone Confirmation)", () => {
    const mode: ConversionMode = "Purchase_Confirmed";

    it("skips at checkout stage", () => {
      const res = resolveConversionForStage(mode, "checkout");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase_Confirmed");
    });

    it("fires Purchase at confirmed stage", () => {
      const res = resolveConversionForStage(mode, "confirmed");
      expect(res).toEqual({
        shouldFire: true,
        eventName: "Purchase",
        stage: "confirmed",
      });
    });

    it("skips at delivered stage", () => {
      const res = resolveConversionForStage(mode, "delivered");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase_Confirmed");
    });
  });

  describe("Mode: Purchase_Delivered (Carrier Delivery)", () => {
    const mode: ConversionMode = "Purchase_Delivered";

    it("skips at checkout stage", () => {
      const res = resolveConversionForStage(mode, "checkout");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase_Delivered");
    });

    it("skips at confirmed stage", () => {
      const res = resolveConversionForStage(mode, "confirmed");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Purchase_Delivered");
    });

    it("fires Purchase at delivered stage", () => {
      const res = resolveConversionForStage(mode, "delivered");
      expect(res).toEqual({
        shouldFire: true,
        eventName: "Purchase",
        stage: "delivered",
      });
    });
  });

  describe("Mode: Lead (Checkout Lead)", () => {
    const mode: ConversionMode = "Lead";

    it("fires Lead at checkout", () => {
      const res = resolveConversionForStage(mode, "checkout");
      expect(res).toEqual({
        shouldFire: true,
        eventName: "Lead",
        stage: "checkout",
      });
    });

    it("skips at confirmed stage", () => {
      const res = resolveConversionForStage(mode, "confirmed");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Lead");
    });

    it("skips at delivered stage", () => {
      const res = resolveConversionForStage(mode, "delivered");
      expect(res.shouldFire).toBe(false);
      expect(res.reason).toContain("Lead");
    });
  });

  describe("Null / Undefined mode defaults to Purchase", () => {
    it("defaults to Purchase at checkout", () => {
      expect(resolveConversionForStage(null, "checkout")).toEqual({
        shouldFire: true,
        eventName: "Purchase",
        stage: "checkout",
      });
      expect(resolveConversionForStage(undefined, "checkout")).toEqual({
        shouldFire: true,
        eventName: "Purchase",
        stage: "checkout",
      });
    });
  });
});

function config(overrides: Partial<CapiDispatchConfig> = {}): CapiDispatchConfig {
  return { enabled: true, accessToken: "EAAG-token", conversionEvent: "Purchase", testMode: false, testEventCode: null, ...overrides };
}

describe("isLongHaulWilaya", () => {
  it("names the southern wilayas whose delivery is sent on the way out", () => {
    expect(isLongHaulWilaya(1)).toBe(true);
    expect(isLongHaulWilaya(37)).toBe(true);
    expect(isLongHaulWilaya(16)).toBe(false);
    expect(isLongHaulWilaya(null)).toBe(false);
  });
});

describe("resolveCapiDispatch", () => {
  it("sends when tracking is enabled, the token is there, and the mode fires this event at this stage", () => {
    expect(resolveCapiDispatch(config(), "Purchase", "checkout")).toEqual({ send: true, testEventCode: null });
  });

  it("skips when tracking is off or not set up", () => {
    expect(resolveCapiDispatch(config({ enabled: false }), "Purchase", "checkout")).toMatchObject({ send: false, reason: "tracking-disabled" });
    expect(resolveCapiDispatch(undefined, "Purchase", "checkout")).toMatchObject({ send: false, reason: "tracking-disabled" });
  });

  it("skips with an actionable reason when the token is missing", () => {
    expect(resolveCapiDispatch(config({ accessToken: "" }), "Purchase", "checkout")).toEqual({
      send: false,
      reason: "no-access-token",
      message: "No CAPI access token — set up the Meta App",
    });
  });

  it("skips an event or a stage the merchant's mode does not fire", () => {
    expect(resolveCapiDispatch(config({ conversionEvent: "Lead" }), "Purchase", "checkout")).toMatchObject({ send: false, reason: "conversion-event-mismatch" });
    expect(resolveCapiDispatch(config({ conversionEvent: "Purchase_Confirmed" }), "Purchase", "checkout")).toMatchObject({ send: false, reason: "conversion-event-mismatch" });
    expect(resolveCapiDispatch(config({ conversionEvent: "Purchase_Confirmed" }), "Purchase", "confirmed")).toEqual({ send: true, testEventCode: null });
    expect(resolveCapiDispatch(config({ conversionEvent: "Purchase_Delivered" }), "Purchase", "delivered")).toEqual({ send: true, testEventCode: null });
    expect(resolveCapiDispatch(config({ conversionEvent: "Lead" }), "Lead", "checkout")).toEqual({ send: true, testEventCode: null });
  });

  it("carries the test event code only while test mode is on", () => {
    expect(resolveCapiDispatch(config({ testMode: true, testEventCode: "TEST123" }), "Purchase", "checkout")).toEqual({ send: true, testEventCode: "TEST123" });
    expect(resolveCapiDispatch(config({ testMode: false, testEventCode: "TEST123" }), "Purchase", "checkout")).toEqual({ send: true, testEventCode: null });
  });
});
