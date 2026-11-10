import type { AppDb } from "@/db";
import { BusinessLogicError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { normalizeOrderLines, CartValidationError, type CartLine } from "../../../../cod-shared/queries/cart";
import * as queries from "./queries";
import type { StoreOrderInput } from "./validation";

/** Every request shape as one list; a basket that breaks its own bounds is a 4xx here, not a crash deeper in. */
export function orderLines(data: StoreOrderInput): CartLine[] {
  try {
    return normalizeOrderLines(data);
  } catch (err) {
    if (err instanceof CartValidationError) {
      throw new ValidationError(err.message, ERROR_CODES.VALUE_OUT_OF_RANGE, err.detail);
    }
    throw err;
  }
}

/** Every line can be ordered, has a SKU, and has the stock to cover it. Each refusal names its line. */
export function assertOrderable(snapshot: queries.CatalogSnapshot, lines: CartLine[]): void {
  const unorderable = queries.findUnorderableLine(snapshot, lines);
  if (unorderable) {
    throw unorderable.variantId
      ? new BusinessLogicError(`Variant ${unorderable.variantId} can no longer be ordered`, ERROR_CODES.VARIANT_NOT_FOUND, { ...unorderable })
      : new BusinessLogicError(`Product ${unorderable.productId} can no longer be ordered`, ERROR_CODES.PRODUCT_NOT_FOUND, { ...unorderable });
  }
  const skuMissing = queries.findMissingSku(snapshot, lines);
  if (skuMissing) {
    throw new BusinessLogicError(
      `SKU is missing on ${skuMissing.missing} ${skuMissing.id} — add a SKU before accepting orders`,
      ERROR_CODES.REQUIRED_FIELD_MISSING,
      { [skuMissing.missing === "variant" ? "variantId" : "productId"]: skuMissing.id }
    );
  }
  const shortfall = queries.findStockShortfall(snapshot, lines);
  if (shortfall) {
    const { message, productId, variantId } = shortfall;
    throw new BusinessLogicError(message, ERROR_CODES.INSUFFICIENT_STOCK, variantId ? { productId, variantId } : { productId });
  }
}

/** A code that does not apply, as the shopper is told. */
export function couponNotApplicable(refusal: queries.CouponRefusal) {
  return new BusinessLogicError("This coupon does not apply to the order", ERROR_CODES.COUPON_NOT_APPLICABLE, { ...refusal });
}

/**
 * The quote the order is charged: what the shopper was shown. Refused before
 * the customer is created, so a refusal leaves no orphan rows.
 */
export async function quoteOrder(db: AppDb, input: { storeId: string | undefined; now: string; snapshot: queries.CatalogSnapshot; lines: CartLine[]; data: StoreOrderInput }) {
  const { data } = input;
  const quote = await queries.quoteCheckout(db, {
    storeId: input.storeId,
    now: input.now,
    snapshot: input.snapshot,
    lines: input.lines,
    destination: { wilayaId: data.wilayaId, communeId: data.communeId, deliveryType: data.deliveryType },
    couponCode: data.couponCode,
    phone: data.phone,
  });
  if (!quote.delivery) {
    throw new BusinessLogicError(
      data.deliveryType === "home" ? "Home delivery is not available to this wilaya" : "Stop-desk delivery is not available to this wilaya",
      ERROR_CODES.DELIVERY_NOT_AVAILABLE,
      { wilayaId: data.wilayaId, deliveryType: data.deliveryType }
    );
  }
  if (quote.couponOutcome && !quote.couponOutcome.applied) throw couponNotApplicable(quote.couponOutcome.refusal);
  return { ...quote, delivery: quote.delivery };
}

export interface OrderToCommit {
  data: StoreOrderInput;
  customFieldAnswers: Parameters<typeof queries.createStoreOrder>[1]["customFieldAnswers"];
  rate: number;
  coupon: Parameters<typeof queries.createStoreOrder>[1]["coupon"];
  snapshot: queries.CatalogSnapshot;
  locale: Parameters<typeof queries.createStoreOrder>[1]["locale"];
  ipAddress: string | undefined;
  userAgent: string | undefined;
  /** Keeps the number the shopper already holds, when one exists. */
  orderNumber?: string;
}

/** Writes the customer and the order. A concurrent request of the same checkout answers with `replay`. */
export async function commitOrder(db: AppDb, input: OrderToCommit) {
  const { data } = input;
  const customer = await queries.findOrCreateCustomer(db, {
    phone: data.phone,
    name: data.customerName,
    email: data.email,
    wilayaId: data.wilayaId,
    communeId: data.communeId,
  });

  // Best-effort: a bad slug never blocks the order; it just leaves it unattributed.
  let landingPageId: string | null = null;
  if (data.landingPageSlug) {
    try {
      landingPageId = await queries.findPublishedLandingPageIdBySlug(db, data.landingPageSlug);
    } catch (err) {
      console.error("[store] landing page attribution lookup failed:", err);
    }
  }

  return queries
    .createStoreOrder(
      db,
      {
        ...data,
        customerId: customer.id,
        customerName: customer.name,
        deliveryFee: input.rate,
        coupon: input.coupon,
        landingPageId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        customerEmail: data.email,
        locale: input.locale,
        customFieldAnswers: input.customFieldAnswers,
        orderNumber: input.orderNumber,
      },
      input.snapshot
    )
    .catch(async (error: unknown) => {
      if (error instanceof queries.CouponNotApplicableError) throw couponNotApplicable(error.refusal);
      if (error instanceof queries.CheckoutAlreadyPlacedError) return { replay: await queries.orderPlacedWith(db, error.checkoutKey) };
      throw error;
    });
}
