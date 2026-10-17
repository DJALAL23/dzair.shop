import type { Translate } from "@/i18n/core";
import { OFFER_KINDS, tiersProblem, type PriceTier } from "../../../../cod-shared/offers/model";
import type { CreateOfferData, Offer, OfferDiscountType, OfferFormValues, OfferStatus } from "./types";

export type OfferSortKey = "name" | "status" | "createdAt" | "triggerQuantity";

export type OfferRoute =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; id: string }
  | { kind: "unknown" };

export interface OfferFilters {
  query: string;
  status: OfferStatus | "all";
  type: OfferDiscountType | "all";
}

export const OFFER_STATUSES: OfferStatus[] = ["active", "inactive"];
export const OFFER_TYPES: readonly OfferDiscountType[] = OFFER_KINDS;

export function parseOfferStatus(value: string | undefined): OfferStatus | undefined {
  return OFFER_STATUSES.includes(value as OfferStatus) ? (value as OfferStatus) : undefined;
}

export function parseOfferType(value: string | undefined): OfferDiscountType | undefined {
  return OFFER_TYPES.includes(value as OfferDiscountType) ? (value as OfferDiscountType) : undefined;
}

export function filterOffers(offers: Offer[], filters: OfferFilters) {
  const q = filters.query.trim().toLocaleLowerCase();
  return offers.filter((offer) => {
    if (filters.status !== "all" && offer.status !== filters.status) return false;
    if (filters.type !== "all" && offer.discountType !== filters.type) return false;
    if (q && `${offer.name} ${offer.triggerProduct?.name ?? ""} ${offer.rewardProduct?.name ?? ""}`.toLocaleLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

export function sortOffers(offers: Offer[], key: OfferSortKey, direction: "asc" | "desc") {
  return [...offers].sort((left, right) => {
    const leftValue = left[key] ?? "";
    const rightValue = right[key] ?? "";
    const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    return direction === "asc" ? comparison : -comparison;
  });
}

export function paginateOffers(offers: Offer[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  return offers.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

export function offerRuleLabel(offer: Pick<Offer, "discountType" | "triggerQuantity" | "rewardQuantity" | "tiers">, t: Translate) {
  if (offer.discountType === "quantity_price") {
    return offer.tiers.map((tier) => t("tier_rule", { quantity: tier.quantity, price: tier.price })).join(" · ");
  }
  if (offer.discountType === "free_shipping") {
    return t("buy_x_free_shipping", { x: offer.triggerQuantity });
  }
  return t("buy_x_get_y", { x: offer.triggerQuantity, y: offer.rewardQuantity });
}

export function offerScheduleLabel(offer: Pick<Offer, "startsAt" | "endsAt">, locale: "ar" | "en" | "fr", t: Translate): string | null {
  const fmt = (value: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  if (offer.startsAt && offer.endsAt) return t("schedule_range", { from: fmt(offer.startsAt), to: fmt(offer.endsAt) });
  if (offer.startsAt) return t("schedule_from", { date: fmt(offer.startsAt) });
  if (offer.endsAt) return t("schedule_until", { date: fmt(offer.endsAt) });
  return null;
}

export function parseOfferRoute(pathname: string): OfferRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/offers") return { kind: "list" };
  if (path === "/offers/new") return { kind: "new" };
  const match = path.match(/^\/offers\/([^/]+)$/);
  if (!match) return { kind: "unknown" };
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id === "new") return { kind: "unknown" };
    return { kind: "edit", id };
  } catch {
    return { kind: "unknown" };
  }
}

export function offerErrorMessage(cause: unknown, t: Translate) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "OFFER_CONFLICT") return t("error_conflict");
  if (code === "INVALID_OFFER") {
    const reason = (cause as { context?: { reason?: unknown } }).context?.reason;
    return typeof reason === "string" ? t(`error_invalid.${reason}`) : t("error_generic");
  }
  if (code === "OFFER_NOT_FOUND") return t("error_not_found");
  if (code === "OFFER_EXPIRED") return t("error_expired");
  if (code === "OFFER_NOT_ACTIVE") return t("error_not_active");
  return t("error_generic");
}

export function formatOfferDate(value: string, locale: "ar" | "en" | "fr") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(date);
}

/** A stored instant as the `datetime-local` input shows it: the merchant's own clock. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The tiers the form holds, as numbers; null when one is not a whole number. */
export function formTiers(form: Pick<OfferFormValues, "tiers">): PriceTier[] | null {
  const tiers = form.tiers.map((tier) => ({ quantity: Number(tier.quantity), price: Number(tier.price), freeShipping: tier.freeShipping }));
  return tiers.every((tier) => Number.isInteger(tier.quantity) && Number.isInteger(tier.price)) ? tiers : null;
}

/** What is wrong with the tiers the form holds, or null — the platform's own rule. */
export function formTiersProblem(form: Pick<OfferFormValues, "tiers">): string | null {
  const tiers = formTiers(form);
  return tiers ? tiersProblem(tiers) : "invalid_tier";
}

/** What one unit costs within a tier, and what the shopper saves against buying them one by one. */
export function tierSaving(tier: PriceTier, unitPrice: number): { perUnit: number; saved: number } {
  return { perUnit: Math.round(tier.price / tier.quantity), saved: Math.max(0, unitPrice * tier.quantity - tier.price) };
}

/**
 * The body the offer form sends. An update only changes what it carries, and
 * `null` clears a stored value while a missing key keeps it — so when editing,
 * an emptied end date, variant or reward must travel as `null`, and a type with
 * no reward product (free shipping) must clear the reward it used to have.
 * A create has nothing stored, so empty fields are left out.
 */
export function offerBody(form: OfferFormValues, editing: boolean): CreateOfferData {
  const empty = editing ? null : undefined;
  const isFree = form.discountType === "free";
  const pricing = form.discountType === "quantity_price";
  return {
    name: form.name.trim(),
    discountType: form.discountType,
    triggerProductId: form.triggerProductId,
    triggerVariantId: form.triggerVariantId || empty,
    ...(pricing ? { tiers: formTiers(form) ?? [] } : { triggerQuantity: parseInt(form.triggerQuantity, 10) }),
    rewardProductId: isFree ? form.rewardProductId : empty,
    rewardVariantId: isFree ? form.rewardVariantId || empty : empty,
    rewardQuantity: isFree ? parseInt(form.rewardQuantity, 10) : 0,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : empty,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : empty,
    status: form.status,
  };
}
