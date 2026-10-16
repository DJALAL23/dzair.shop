import { ZR_MAPPABLE_MEANINGS } from "../../../../cod-shared/carriers/providers";
import { RETRYABLE_RESULTS } from "../../../../cod-shared/inbound/results";
import type {
  DeliveryCompany,
  Driver,
  DriverPaymentType,
  DriverStatus,
  PendingSettlement,
  ProviderConfig,
  ShippingProfile,
  ShippingRateEntry,
  ShippingRateMap,
  ShippingRule,
  VehicleType,
} from "./types";

export type DriverSortKey = "firstName" | "phone" | "status" | "compensationWilayaCount" | "totalDelivered" | "totalEarnings";

export type DriverRoute =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "compensations"; id: string }
  | { kind: "unknown" };

export type DeliveryCompanyRoute =
  | { kind: "list" }
  | { kind: "detail"; code: string }
  | { kind: "credentials"; code: string }
  | { kind: "stopDesks"; code: string }
  | { kind: "unknown" };

export interface DriverFilters {
  query: string;
  status: DriverStatus | "all";
}

export const DRIVER_STATUSES: DriverStatus[] = ["available", "busy", "inactive"];
export const VEHICLE_TYPES: VehicleType[] = ["motorcycle", "car", "van"];

export function parseDriverStatus(value: string | undefined): DriverStatus | undefined {
  return DRIVER_STATUSES.includes(value as DriverStatus) ? (value as DriverStatus) : undefined;
}

export function driverFullName(driver: Pick<Driver, "firstName" | "lastName">) {
  return `${driver.firstName} ${driver.lastName}`.trim();
}

export function driverInitials(driver: Pick<Driver, "firstName" | "lastName">) {
  return (driver.firstName.charAt(0) + driver.lastName.charAt(0)).toUpperCase();
}

export function filterDrivers(drivers: Driver[], filters: DriverFilters) {
  const q = filters.query.trim().toLocaleLowerCase();
  return drivers.filter((driver) => {
    if (filters.status !== "all" && driver.status !== filters.status) return false;
    if (q && `${driverFullName(driver)} ${driver.phone} ${driver.phone2 ?? ""}`.toLocaleLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

export function sortDrivers(drivers: Driver[], key: DriverSortKey, direction: "asc" | "desc") {
  return [...drivers].sort((left, right) => {
    const leftValue = key === "firstName" ? driverFullName(left) : (left[key] ?? "");
    const rightValue = key === "firstName" ? driverFullName(right) : (right[key] ?? "");
    const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    return direction === "asc" ? comparison : -comparison;
  });
}

export function paginateDrivers(drivers: Driver[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  return drivers.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

/** What the driver and the store still owe each other on these deliveries. */
export function pendingTotals(rows: PendingSettlement[]) {
  const cash = rows.filter((row) => !row.codPaymentId);
  const fees = rows.filter((row) => !row.feePaymentId);
  return {
    cash: cash.reduce((sum, row) => sum + row.codAmount, 0),
    cashCount: cash.length,
    fees: fees.reduce((sum, row) => sum + row.driverFee, 0),
    feeCount: fees.length,
  };
}

/**
 * The payment a settlement of these deliveries would record, as the server
 * computes it: the cash the driver hands over, the fees the store pays, or
 * both at once (cash less fees). Each part settles once, so only the
 * deliveries whose part is still open are in it.
 */
export function settlementOf(type: DriverPaymentType, rows: PendingSettlement[]): { shipmentIds: string[]; amount: number } {
  const open =
    type === "cod_remittance"
      ? rows.filter((row) => !row.codPaymentId)
      : type === "fee_payment"
        ? rows.filter((row) => !row.feePaymentId)
        : rows.filter((row) => !row.codPaymentId && !row.feePaymentId);
  const amount = open.reduce(
    (sum, row) => sum + (type === "cod_remittance" ? row.codAmount : type === "fee_payment" ? row.driverFee : row.codAmount - row.driverFee),
    0,
  );
  return { shipmentIds: open.map((row) => row.shipmentId), amount };
}

/** A delivery is fully settled once both its cash and its fee are. */
export function isSettled(row: Pick<PendingSettlement, "codPaymentId" | "feePaymentId">): boolean {
  return Boolean(row.codPaymentId && row.feePaymentId);
}

export function parseDriverRoute(pathname: string): DriverRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/delivery/drivers") return { kind: "list" };
  if (path === "/delivery/drivers/new") return { kind: "new" };
  const match = path.match(/^\/delivery\/drivers\/([^/]+)(?:\/(edit|compensations))?$/);
  if (!match) return { kind: "unknown" };
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id === "new") return { kind: "unknown" };
    if (match[2] === "edit") return { kind: "edit", id };
    if (match[2] === "compensations") return { kind: "compensations", id };
    return { kind: "detail", id };
  } catch {
    return { kind: "unknown" };
  }
}

export function driverErrorMessage(cause: unknown, t: (key: string) => string) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "DRIVER_NOT_FOUND") return t("error_not_found");
  if (code === "DRIVER_HAS_ACTIVE_ORDERS") return t("error_cannot_delete_with_orders");
  if (code === "DUPLICATE_PHONE") return t("error_duplicate_phone");
  if (code === "PAYMENT_ALREADY_SETTLED") return t("error_already_settled");
  if (code === "ORDER_NOT_FOUND") return t("error_order_not_found");
  return t("error_generic");
}

export function formatDeliveryMoney(amount: number | null | undefined, locale: "ar" | "en" | "fr") {
  if (amount == null) return "-";
  return `${new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(amount)} DA`;
}

export function formatDeliveryDate(value: string, locale: "ar" | "en" | "fr") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(date);
}

export function settlementLabel(type: DriverPaymentType, t: (key: string) => string) {
  return t(`payments.type_${type}`);
}

export function parseDeliveryCompanyRoute(pathname: string): DeliveryCompanyRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/delivery/companies") return { kind: "list" };
  const match = path.match(/^\/delivery\/companies\/([^/]+)(?:\/(credentials|stop-desks))?$/);
  if (!match) return { kind: "unknown" };
  try {
    const code = decodeURIComponent(match[1]);
    if (!code) return { kind: "unknown" };
    if (match[2] === "credentials") return { kind: "credentials", code };
    if (match[2] === "stop-desks") return { kind: "stopDesks", code };
    return { kind: "detail", code };
  } catch {
    return { kind: "unknown" };
  }
}

// ─── Shipping Profiles ────────────────────────────────────────────────────────

export type ShippingProfileRoute =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "unknown" };

export function parseShippingProfileRoute(pathname: string): ShippingProfileRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/delivery/shipping-profiles") return { kind: "list" };
  if (path === "/delivery/shipping-profiles/new") return { kind: "new" };
  const match = path.match(/^\/delivery\/shipping-profiles\/([^/]+)(?:\/(edit))?$/);
  if (!match) return { kind: "unknown" };
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id === "new") return { kind: "unknown" };
    if (match[2] === "edit") return { kind: "edit", id };
    return { kind: "detail", id };
  } catch {
    return { kind: "unknown" };
  }
}

export function defaultRateEntry(): ShippingRateEntry {
  return { homePrice: 0, stopDeskPrice: 0, homeEnabled: true, stopDeskEnabled: false };
}

export function buildRateMap(rules: ShippingRule[]): ShippingRateMap {
  const map: ShippingRateMap = {};
  for (const rule of rules) {
    map[rule.wilayaId] = {
      homePrice: rule.homePrice,
      stopDeskPrice: rule.stopDeskPrice,
      homeEnabled: rule.homeEnabled ?? true,
      stopDeskEnabled: rule.stopDeskEnabled ?? false,
    };
  }
  return map;
}

export function filterShippingProfiles(profiles: ShippingProfile[], query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return profiles;
  return profiles.filter(
    (profile) =>
      profile.name.toLocaleLowerCase().includes(q) ||
      (profile.notes ?? "").toLocaleLowerCase().includes(q),
  );
}

export function sortShippingProfiles(profiles: ShippingProfile[]) {
  return [...profiles].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function paginateShippingProfiles(profiles: ShippingProfile[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  return profiles.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

export function shippingErrorMessage(cause: unknown, t: (key: string) => string) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "SHIPPING_PROFILE_NOT_FOUND") return t("error_not_found");
  if (code === "PROFILE_IN_USE") return t("shipping_profiles.error_profile_in_use");
  if (code === "DEFAULT_PROFILE_REQUIRED") return t("shipping_profiles.error_default_required");
  if (code === "DUPLICATE_WILAYA_RULE") return t("shipping_profiles.error_duplicate_wilaya");
  return t("error_generic");
}

// ─── Delivery company settings ──────────────────────────────────────────────

/**
 * What connecting a company sends besides its credentials: its carrier
 * platform, and that platform's settings — Yalidine and Guepex take the
 * sender's wilaya, in their own spelling.
 */
export function companySettingsFor(config: Pick<ProviderConfig, "provider" | "platform" | "requiresFromWilaya">, fromWilayaName: string) {
  const wilaya = fromWilayaName.trim();
  if (config.provider !== "yalidine") return { provider: config.provider };
  return { provider: config.provider, providerConfig: { platform: config.platform ?? "yalidine", ...(config.requiresFromWilaya && wilaya ? { fromWilayaName: wilaya } : {}) } };
}

/** The sender's wilaya a Yalidine-platform company has saved. */
export function fromWilayaOf(company: Pick<DeliveryCompany, "providerConfig"> | null): string {
  const value = company?.providerConfig?.fromWilayaName;
  return typeof value === "string" ? value : "";
}

export type ZrMeaning = (typeof ZR_MAPPABLE_MEANINGS)[number];

/** A ZR company's own state names per meaning, as the form edits them (comma separated). */
export function statusMapDraft(company: Pick<DeliveryCompany, "providerConfig"> | null): Record<ZrMeaning, string> {
  const stored = (company?.providerConfig?.statusMap ?? {}) as Partial<Record<string, unknown>>;
  return Object.fromEntries(
    ZR_MAPPABLE_MEANINGS.map((meaning) => {
      const names = stored[meaning];
      return [meaning, Array.isArray(names) ? names.filter((n) => typeof n === "string").join(", ") : ""];
    }),
  ) as Record<ZrMeaning, string>;
}

/** The status map the form's text saves: each name once, trimmed; meanings left empty are left out. */
export function statusMapFrom(draft: Record<ZrMeaning, string>): Partial<Record<ZrMeaning, string[]>> {
  const map: Partial<Record<ZrMeaning, string[]>> = {};
  for (const meaning of ZR_MAPPABLE_MEANINGS) {
    const names = [...new Set((draft[meaning] ?? "").split(",").map((name) => name.trim()).filter(Boolean))];
    if (names.length) map[meaning] = names;
  }
  return map;
}

/** Inbox events that went wrong and can be processed again, after fixing what stopped them. */
export function canRetryEvent(result: string): boolean {
  return RETRYABLE_RESULTS.includes(result);
}

/**
 * How a company's updates are pushed to CodFlow, if they are: ZR registers
 * its webhook in one click, Yalidine's secret is pasted from its dashboard;
 * every other carrier is checked every few minutes and needs nothing.
 */
export function webhookSetup(
  config: Pick<ProviderConfig, "provider" | "updates">,
  company: Pick<DeliveryCompany, "webhookEndpointId" | "webhookSecretSet"> | null,
): { kind: "none" } | { kind: "register" | "secret"; ready: boolean } {
  if (config.updates !== "webhook") return { kind: "none" };
  if (config.provider === "zr_express") return { kind: "register", ready: Boolean(company?.webhookEndpointId) };
  return { kind: "secret", ready: Boolean(company?.webhookSecretSet) };
}

/** A carrier host the merchant typed: an http(s) address without trailing slashes, or null. */
export function carrierHostFrom(value: string): string | null {
  const text = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? text : null;
  } catch {
    return null;
  }
}

/** The message that explains a failed connect, by what the server said. */
export function connectErrorKey(cause: unknown): "error_token_refused" | "error_carrier_unreachable" | "error_carrier_busy" | "error_host_refused" | "error_saving" {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === "CARRIER_AUTH_FAILED") return "error_token_refused";
  if (code === "CARRIER_UNAVAILABLE" || code === "CARRIER_OUTCOME_UNKNOWN") return "error_carrier_unreachable";
  if (code === "CARRIER_RATE_LIMITED") return "error_carrier_busy";
  if (code === "CARRIER_REJECTED") return "error_host_refused";
  return "error_saving";
}

/** A company is connected while it has credentials and is switched on; Disconnect only switches it off, so its parcels can still be tracked. */
export function isCompanyConnected(company: Pick<DeliveryCompany, "isConnected" | "active"> | null | undefined): boolean {
  return !!company && company.isConnected && company.active;
}
