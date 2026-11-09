import { describe, expect, it } from "vitest";
import {
  buildRateMap,
  canRetryEvent,
  carrierHostFrom,
  connectErrorKey,
  placesReadError,
  companySettingsFor,
  fromWilayaOf,
  isCompanyConnected,
  statusMapDraft,
  statusMapFrom,
  webhookSetup,
  webhookNeedsAction,
  driverErrorMessage,
  driverFullName,
  isSettled,
  pendingTotals,
  settlementOf,
  driverInitials,
  filterDrivers,
  filterShippingProfiles,
  formatDeliveryDate,
  formatDeliveryMoney,
  formatPriceRange,
  paginateDrivers,
  paginateShippingProfiles,
  parseDriverRoute,
  parseShippingProfileRoute,
  shippingErrorMessage,
  sortDrivers,
  sortShippingProfiles,
} from "./model";
import type { DeliveryCompany, Driver, PendingSettlement, ShippingProfile, ShippingRule } from "./types";

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: "driver-1",
  firstName: "Ahmed",
  lastName: "Benali",
  phone: "0551234567",
  phone2: null,
  vehicleType: "motorcycle",
  status: "available",
  compensationWilayaCount: 3,
  totalDelivered: 10,
  totalEarnings: 12000,
  pendingCash: 5000,
  totalPaid: 7000,
  notes: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  ...overrides,
});

const pending = (overrides: Partial<PendingSettlement> = {}): PendingSettlement => ({
  shipmentId: "s1",
  orderId: "o1",
  orderNumber: "ORD-001",
  customerName: "Karim",
  codAmount: 9400,
  driverFee: 300,
  deliveredAt: "2026-08-26T00:00:00.000Z",
  codPaymentId: null,
  feePaymentId: null,
  ...overrides,
});

const t = (key: string) => key;

describe("delivery model", () => {
  it("filters drivers by query and status", () => {
    const rows = [driver(), driver({ id: "2", firstName: "Salima", lastName: "Mansouri", phone: "0771234567", status: "inactive" })];
    expect(filterDrivers(rows, { query: "benali", status: "all" }).map((item) => item.id)).toEqual(["driver-1"]);
    expect(filterDrivers(rows, { query: "", status: "inactive" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("sorts and paginates driver collections", () => {
    const rows = [driver({ id: "1", firstName: "Zed" }), driver({ id: "2", firstName: "Amel" }), driver({ id: "3", firstName: "Meriem" })];
    expect(sortDrivers(rows, "firstName", "asc").map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(paginateDrivers(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });

  it("settles each part of a delivery once, for the amount the server computes", () => {
    const rows = [pending({ shipmentId: "a" }), pending({ shipmentId: "b", codPaymentId: "p1" }), pending({ shipmentId: "c", feePaymentId: "p2", driverFee: 500 })];
    expect(settlementOf("cod_remittance", rows)).toEqual({ shipmentIds: ["a", "c"], amount: 18800 });
    expect(settlementOf("fee_payment", rows)).toEqual({ shipmentIds: ["a", "b"], amount: 600 });
    expect(settlementOf("net_settlement", rows)).toEqual({ shipmentIds: ["a"], amount: 9100 });
    expect(pendingTotals(rows)).toEqual({ cash: 18800, cashCount: 2, fees: 600, feeCount: 2 });
    expect(isSettled(pending({ codPaymentId: "p", feePaymentId: "q" }))).toBe(true);
    expect(isSettled(pending({ codPaymentId: "p" }))).toBe(false);
  });

  it("names drivers", () => {
    expect(driverFullName(driver())).toBe("Ahmed Benali");
    expect(driverInitials(driver())).toBe("AB");
  });

  it("maps business error codes and formats values", () => {
    expect(driverErrorMessage({ code: "DRIVER_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(driverErrorMessage({ code: "DRIVER_HAS_ACTIVE_ORDERS" }, t)).toBe("error_cannot_delete_with_orders");
    expect(driverErrorMessage({ code: "DUPLICATE_PHONE" }, t)).toBe("error_duplicate_phone");
    expect(driverErrorMessage(new Error("boom"), t)).toBe("error_generic");
    expect(formatDeliveryMoney(9400, "en")).toBe("9,400 DA");
    expect(formatDeliveryMoney(null, "en")).toBe("-");
    expect(formatPriceRange({ min: 500, max: 500 }, "en")).toBe("500 DA");
    expect(formatPriceRange({ min: 500, max: 1050 }, "en")).toBe("500–1,050 DA");
    expect(formatPriceRange(null, "en")).toBe("-");
    expect(formatDeliveryDate("2026-08-26T00:00:00.000Z", "en")).toBe("8/26/2026");
    expect(formatDeliveryDate("not-a-date", "en")).toBe("-");
  });

  it("parses only valid shipping profile routes", () => {
    expect(parseShippingProfileRoute("/delivery/shipping-profiles")).toEqual({ kind: "list" });
    expect(parseShippingProfileRoute("/delivery/shipping-profiles/new/")).toEqual({ kind: "new" });
    expect(parseShippingProfileRoute("/delivery/shipping-profiles/profile-1")).toEqual({ kind: "detail", id: "profile-1" });
    expect(parseShippingProfileRoute("/delivery/shipping-profiles/profile%2F1/edit")).toEqual({ kind: "edit", id: "profile/1" });
    expect(parseShippingProfileRoute("/delivery/shipping-profiles/profile-1/unknown")).toEqual({ kind: "unknown" });
    expect(parseShippingProfileRoute("/delivery/drivers")).toEqual({ kind: "unknown" });
  });

  it("builds a rate map from rules with defaults for missing switches", () => {
    const rule = (overrides: Partial<ShippingRule> = {}): ShippingRule => ({
      id: "rule-1",
      profileId: "profile-1",
      wilayaId: 16,
      wilayaName: "Alger",
      wilayaNameAr: "الجزائر",
      homePrice: 400,
      stopDeskPrice: 300,
      homeEnabled: true,
      stopDeskEnabled: false,
      createdAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    });
    const map = buildRateMap([rule(), rule({ wilayaId: 31, homeEnabled: false })]);
    expect(map[16]).toEqual({ homePrice: 400, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: false });
    expect(map[31]).toEqual({ homePrice: 400, stopDeskPrice: 300, homeEnabled: false, stopDeskEnabled: false });
  });

  it("filters, sorts and paginates shipping profiles", () => {
    const profile = (overrides: Partial<ShippingProfile> = {}): ShippingProfile => ({
      id: "profile-1",
      name: "Standard Rates",
      isDefault: false,
      notes: null,
      ruleCount: 3,
      productCount: 0,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    });
    const rows = [
      profile({ id: "1", name: "Zed" }),
      profile({ id: "2", name: "Amel", isDefault: true }),
      profile({ id: "3", name: "Meriem" }),
    ];
    expect(filterShippingProfiles(rows, "amel").map((item) => item.id)).toEqual(["2"]);
    expect(filterShippingProfiles(rows, "").map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(sortShippingProfiles(rows).map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(paginateShippingProfiles(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });

  it("maps shipping profile business error codes", () => {
    expect(shippingErrorMessage({ code: "PROFILE_IN_USE" }, t)).toBe("shipping_profiles.error_profile_in_use");
    expect(shippingErrorMessage({ code: "DEFAULT_PROFILE_REQUIRED" }, t)).toBe("shipping_profiles.error_default_required");
    expect(shippingErrorMessage({ code: "DUPLICATE_WILAYA_RULE" }, t)).toBe("shipping_profiles.error_duplicate_wilaya");
    expect(shippingErrorMessage({ code: "SHIPPING_PROFILE_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(shippingErrorMessage(new Error("boom"), t)).toBe("error_generic");
  });
});

describe("delivery company settings", () => {
  it("sends each company's platform, and the sender's wilaya to Yalidine and Guepex", () => {
    expect(companySettingsFor({ provider: "yalidine", platform: "guepex", requiresFromWilaya: true }, " Batna ")).toEqual({ provider: "yalidine", providerConfig: { platform: "guepex", fromWilayaName: "Batna" } });
    expect(companySettingsFor({ provider: "yalidine", requiresFromWilaya: true }, "")).toEqual({ provider: "yalidine", providerConfig: { platform: "yalidine" } });
    expect(companySettingsFor({ provider: "ecotrack" }, "Batna")).toEqual({ provider: "ecotrack" });
    expect(fromWilayaOf({ providerConfig: { platform: "yalidine", fromWilayaName: "Oran" } })).toBe("Oran");
    expect(fromWilayaOf({ providerConfig: null })).toBe("");
  });

  it("edits ZR's own state names by meaning, and saves each once", () => {
    const draft = statusMapDraft({ providerConfig: { statusMap: { delivered: ["Livré", "Remis"], returned: ["Retour reçu"] } } });
    expect(draft.delivered).toBe("Livré, Remis");
    expect(draft.cancelled).toBe("");
    expect(statusMapFrom({ ...draft, delivered: " Livré, Remis ,Livré, ", returned: "" })).toEqual({ delivered: ["Livré", "Remis"] });
  });

  it("retries only the inbox events that went wrong", () => {
    expect(["error", "dead", "unmatched", "unknown_status", "unmapped"].every(canRetryEvent)).toBe(true);
    expect(["ok", "ignored", "pending", "deferred_settlement"].some(canRetryEvent)).toBe(false);
  });
});

describe("a company's webhook setup", () => {
  it("follows its platform, never its code", () => {
    const company = { webhookEndpointId: null, webhookSecretSet: false };
    expect(webhookSetup({ provider: "zr_express", updates: "webhook" }, { ...company, webhookEndpointId: "ep" })).toEqual({ kind: "register", ready: true });
    expect(webhookSetup({ provider: "yalidine", updates: "webhook" }, company)).toEqual({ kind: "secret", ready: false });
    expect(webhookSetup({ provider: "yalidine", updates: "webhook" }, { ...company, webhookSecretSet: true })).toEqual({ kind: "secret", ready: true });
    expect(webhookSetup({ provider: "yalidine", updates: "pull" }, company)).toEqual({ kind: "none" });
    expect(webhookSetup({ provider: "ecotrack", updates: "pull" }, company)).toEqual({ kind: "none" });
  });

  it("needs the merchant's action while a pushing carrier's webhook is not set up — never for one that is checked", () => {
    const company = { webhookEndpointId: null, webhookSecretSet: false };
    expect(webhookNeedsAction({ provider: "yalidine", updates: "webhook" }, company)).toBe(true);
    expect(webhookNeedsAction({ provider: "yalidine", updates: "webhook" }, { ...company, webhookSecretSet: true })).toBe(false);
    expect(webhookNeedsAction({ provider: "zr_express", updates: "webhook" }, company)).toBe(true);
    expect(webhookNeedsAction({ provider: "zr_express", updates: "webhook" }, { ...company, webhookEndpointId: "ep" })).toBe(false);
    expect(webhookNeedsAction({ provider: "ecotrack", updates: "pull" }, company)).toBe(false);
  });
});

describe("a carrier host typed by hand", () => {
  it("accepts an http(s) address and drops what trails it", () => {
    expect(carrierHostFrom("  https://mono2.ecotrack.dz/  ")).toBe("https://mono2.ecotrack.dz");
    expect(carrierHostFrom("http://localhost:9000///")).toBe("http://localhost:9000");
    expect(carrierHostFrom("https://x.ecotrack.dz/api/v1")).toBe("https://x.ecotrack.dz/api/v1");
  });

  it("refuses anything else, including a bare host without a scheme", () => {
    for (const value of ["", "   ", "mono2.ecotrack.dz", "ftp://x.dz", "https://", "not a url"]) expect(carrierHostFrom(value), value).toBeNull();
  });
});

describe("why connecting a carrier failed", () => {
  const api = (_status: number, code: string) => Object.assign(new Error("x"), { code });

  it("tells a refused token from an unreachable carrier from anything else", () => {
    expect(connectErrorKey(api(409, "CARRIER_AUTH_FAILED"))).toBe("error_token_refused");
    expect(connectErrorKey(api(502, "CARRIER_UNAVAILABLE"))).toBe("error_carrier_unreachable");
    expect(connectErrorKey(api(502, "CARRIER_OUTCOME_UNKNOWN"))).toBe("error_carrier_unreachable");
    expect(connectErrorKey(api(429, "CARRIER_RATE_LIMITED"))).toBe("error_carrier_busy");
    expect(connectErrorKey(api(422, "CARRIER_REJECTED"))).toBe("error_host_refused");
    expect(connectErrorKey(api(409, "CARRIER_MISCONFIGURED"))).toBe("error_saving");
    expect(connectErrorKey(new Error("boom"))).toBe("error_saving");
  });
});

describe("why a company's places could not be read", () => {
  const api = (message: string, code: string) => Object.assign(new Error(message), { code });

  it("says the server's own reason, never a bare 'did not answer'", () => {
    expect(placesReadError(api("Carrier HTTP 403 (Access denied)", "CARRIER_UNAVAILABLE"))).toEqual({ key: "places_read_failed", reason: "Carrier HTTP 403 (Access denied)" });
    expect(placesReadError(api("The sender's wilaya is unknown", "CARRIER_MISCONFIGURED"))).toEqual({ key: "places_read_failed", reason: "The sender's wilaya is unknown" });
    expect(placesReadError(new Error("Failed to fetch"))).toEqual({ key: "places_read_failed", reason: "Failed to fetch" });
  });

  it("tells refused keys and a busy carrier apart", () => {
    expect(placesReadError(api("x", "CARRIER_AUTH_FAILED")).key).toBe("places_read_keys_refused");
    expect(placesReadError(api("x", "CARRIER_RATE_LIMITED")).key).toBe("places_read_busy");
  });
});

describe("when a company counts as connected", () => {
  const company = (isConnected: boolean, active: boolean) => ({ isConnected, active }) as Pick<DeliveryCompany, "isConnected" | "active">;

  it("needs stored credentials and an active company: Disconnect switches it off but keeps the token for its parcels", () => {
    expect(isCompanyConnected(company(true, true))).toBe(true);
    expect(isCompanyConnected(company(true, false))).toBe(false);
    expect(isCompanyConnected(company(false, true))).toBe(false);
    expect(isCompanyConnected(null)).toBe(false);
    expect(isCompanyConnected(undefined)).toBe(false);
  });
});
