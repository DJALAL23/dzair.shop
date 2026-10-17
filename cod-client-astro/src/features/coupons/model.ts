import type { Translate } from "@/i18n/core";
import { formatMoney } from "@/features/orders/model";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";
import { couponProblem, normalizeCouponCode, type CouponProblem } from "../../../../cod-shared/coupons/model";
import type { Coupon, CouponBody, CouponFormValues, CouponState, CouponSummary } from "./types";

export type CouponRoute = { kind: "list" } | { kind: "new" } | { kind: "edit"; id: string } | { kind: "unknown" };

export function parseCouponRoute(pathname: string): CouponRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/coupons") return { kind: "list" };
  if (path === "/coupons/new") return { kind: "new" };
  const match = path.match(/^\/coupons\/([^/]+)$/);
  if (!match) return { kind: "unknown" };
  try {
    const id = decodeURIComponent(match[1]!);
    return id ? { kind: "edit", id } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

export const EMPTY_COUPON_FORM: CouponFormValues = {
  code: "",
  kind: "percentage",
  value: "10",
  maxDiscount: "",
  minimum: "none",
  minimumValue: "",
  scope: "store",
  products: [],
  collections: [],
  audience: "everyone",
  customers: [],
  groups: [],
  usageLimit: "",
  oncePerCustomer: false,
  startsAt: "",
  endsAt: "",
  status: "active",
};

/** The form a stored coupon fills. */
export function couponForm(coupon: Coupon): CouponFormValues {
  return {
    code: coupon.code,
    kind: coupon.kind,
    value: coupon.kind === "free_shipping" ? "" : String(coupon.value),
    maxDiscount: coupon.maxDiscount === null ? "" : String(coupon.maxDiscount),
    minimum: coupon.minSubtotal !== null ? "subtotal" : coupon.minQuantity !== null ? "quantity" : "none",
    minimumValue: String(coupon.minSubtotal ?? coupon.minQuantity ?? ""),
    scope: coupon.scope,
    products: coupon.products.map((product) => ({ id: product.id, label: product.name })),
    collections: coupon.collections.map((collection) => ({ id: collection.id, label: collection.title })),
    audience: coupon.audience,
    customers: coupon.customers.map((customer) => ({ id: customer.id, label: customer.name, detail: customer.phone })),
    groups: coupon.groups.map((group) => ({ id: group.id, label: group.name })),
    usageLimit: coupon.usageLimit === null ? "" : String(coupon.usageLimit),
    oncePerCustomer: coupon.oncePerCustomer,
    startsAt: toLocalInput(coupon.startsAt),
    endsAt: toLocalInput(coupon.endsAt),
    status: coupon.status,
  };
}

/** A typed whole number, or null for an empty field; NaN for anything else, for the rules to refuse. */
function amount(typed: string): number | null {
  return typed.trim() === "" ? null : Number(typed);
}

/**
 * The body the form sends. Only what the kind, the minimum, the scope and the
 * audience use is sent with a value; on an update, what they do not use is
 * cleared (`null`, or an empty list), so a coupon turned from a percentage into
 * free delivery drops its cap. A create has nothing stored to clear.
 */
export function couponBody(form: CouponFormValues, editing: boolean): CouponBody {
  const empty = editing ? null : undefined;
  const typedMinimum = amount(form.minimumValue);
  return {
    code: form.code,
    kind: form.kind,
    ...(form.kind === "free_shipping" ? {} : { value: amount(form.value) ?? Number.NaN }),
    maxDiscount: form.kind === "percentage" ? (amount(form.maxDiscount) ?? empty) : empty,
    minSubtotal: form.minimum === "subtotal" ? (typedMinimum ?? Number.NaN) : empty,
    minQuantity: form.minimum === "quantity" ? (typedMinimum ?? Number.NaN) : empty,
    scope: form.scope,
    productIds: form.scope === "products" ? form.products.map((pick) => pick.id) : [],
    collectionIds: form.scope === "collections" ? form.collections.map((pick) => pick.id) : [],
    audience: form.audience,
    customerIds: form.audience === "selected" ? form.customers.map((pick) => pick.id) : [],
    groupIds: form.audience === "selected" ? form.groups.map((pick) => pick.id) : [],
    usageLimit: amount(form.usageLimit) ?? empty,
    oncePerCustomer: form.oncePerCustomer,
    startsAt: fromLocalInput(form.startsAt) ?? empty,
    endsAt: fromLocalInput(form.endsAt) ?? empty,
    status: form.status,
  };
}

/**
 * What is wrong with the coupon the form describes, or null — judged by the
 * platform's own rule (`couponProblem`), on the body the form would send.
 */
export function couponFormProblem(form: CouponFormValues): CouponProblem | null {
  const body = couponBody(form, false);
  return couponProblem({
    code: normalizeCouponCode(body.code) ?? body.code,
    kind: body.kind,
    value: body.value ?? 0,
    maxDiscount: body.maxDiscount ?? null,
    minSubtotal: body.minSubtotal ?? null,
    minQuantity: body.minQuantity ?? null,
    scope: body.scope,
    productIds: body.productIds,
    collectionIds: body.collectionIds,
    audience: body.audience,
    customerIds: body.customerIds,
    groupIds: body.groupIds,
    usageLimit: body.usageLimit ?? null,
    oncePerCustomer: body.oncePerCustomer,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
  });
}

/** What the coupon gives, in a few words: "10% off (up to 1 500 DA)", "500 DA off", "Free delivery". */
export function couponValueLabel(coupon: Pick<CouponSummary, "kind" | "value" | "maxDiscount">, t: Translate, locale: "ar" | "en" | "fr"): string {
  if (coupon.kind === "free_shipping") return t("value.free_shipping");
  if (coupon.kind === "fixed_amount") return t("value.fixed_amount", { amount: formatMoney(coupon.value, locale) });
  return coupon.maxDiscount === null
    ? t("value.percentage", { percent: coupon.value })
    : t("value.percentage_capped", { percent: coupon.value, max: formatMoney(coupon.maxDiscount, locale) });
}

/** What the coupon covers, as the list shows it. */
export function couponScopeLabel(coupon: Pick<CouponSummary, "scope" | "counts">, t: Translate): string {
  if (coupon.scope === "products") return t("scope_label.products", { count: coupon.counts.products });
  if (coupon.scope === "collections") return t("scope_label.collections", { count: coupon.counts.collections });
  return t("scope_label.store");
}

/** What a shopper must meet besides the code — who, how much, how often — in a few words; null when nothing. */
export function couponConditionsLabel(
  coupon: Pick<CouponSummary, "audience" | "minSubtotal" | "minQuantity" | "oncePerCustomer">,
  t: Translate,
  locale: "ar" | "en" | "fr",
): string | null {
  const parts = [
    coupon.audience === "selected" ? t("conditions.selected") : null,
    coupon.minSubtotal !== null ? t("conditions.min_subtotal", { amount: formatMoney(coupon.minSubtotal, locale) }) : null,
    coupon.minQuantity !== null ? t("conditions.min_items", { count: coupon.minQuantity }) : null,
    coupon.oncePerCustomer ? t("conditions.once_per_customer") : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : null;
}

/** Uses so far, against the limit when there is one. */
export function couponUsesLabel(coupon: Pick<CouponSummary, "uses" | "usageLimit">, t: Translate): string {
  return coupon.usageLimit === null ? t("uses_label.unlimited", { used: coupon.uses }) : t("uses_label.limited", { used: coupon.uses, limit: coupon.usageLimit });
}

export const COUPON_STATE_TONE: Record<CouponState, "success" | "neutral" | "info" | "warning"> = {
  live: "success",
  scheduled: "info",
  inactive: "neutral",
  expired: "neutral",
  used_up: "warning",
};

/** The coupons whose code holds the query, case and spaces aside. */
export function searchCoupons(coupons: CouponSummary[], query: string): CouponSummary[] {
  const wanted = query.replace(/\s+/g, "").toUpperCase();
  return wanted ? coupons.filter((coupon) => coupon.code.includes(wanted)) : coupons;
}

/** Why a read or a write failed, as the merchant reads it. */
export function couponErrorMessage(cause: unknown, t: Translate): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "COUPON_CODE_TAKEN") return t("error_code_taken");
  if (code === "INVALID_COUPON") {
    const reason = (cause as { context?: { reason?: unknown } }).context?.reason;
    return typeof reason === "string" ? t(`error_invalid.${reason}`) : t("error_generic");
  }
  if (code === "COUPON_NOT_FOUND") return t("error_not_found");
  return t("error_generic");
}

/** Letters and digits a shopper cannot misread: no 0/O, 1/I/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A fresh code, eight characters a shopper can read off an ad and type back. */
export function generateCouponCode(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): string {
  return Array.from(random(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
