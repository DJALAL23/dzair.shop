/**
 * The delivery an order the merchant enters (dashboard, API, AI tools)
 * charges. The store's quote decides — `quoteOrderDelivery`, the storefront
 * checkout's own rules: every product's shipping profile, a commune's price,
 * the "free delivery above" amount, an offer's free delivery for a basket of
 * its product alone — unless the merchant typed a fee for an offline order,
 * which is then theirs. Where the store does not deliver, an online order is
 * refused and an offline one charges the merchant's fee, or nothing.
 */

import type { AppDb } from "@/db";
import { BusinessLogicError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { quoteOrderDelivery } from "../../../../cod-shared/queries/delivery-quote";

export interface OrderDeliveryRequest {
  orderType: "online" | "offline";
  /** A fee the merchant typed; kept on an offline order. */
  deliveryFee?: number | null;
  wilayaId: number;
  communeId?: string | null;
  deliveryType: "home" | "stop_desk";
  /** The order's subtotal. */
  price: number;
  products: Array<{ productId: string; variantId?: string | null; quantity: number }>;
}

export interface OrderDelivery {
  deliveryFee: number;
  /** The offer that made delivery free, recorded on the order as the storefront records it. */
  deliveryOfferId: string | null;
  deliveryOfferName: string | null;
}

export async function orderDelivery(db: AppDb, request: OrderDeliveryRequest): Promise<OrderDelivery> {
  if (request.orderType === "offline" && request.deliveryFee != null) {
    return { deliveryFee: request.deliveryFee, deliveryOfferId: null, deliveryOfferName: null };
  }
  const quote = await quoteOrderDelivery(db, {
    lines: request.products,
    subtotal: request.price,
    wilayaId: request.wilayaId,
    communeId: request.communeId ?? null,
    deliveryType: request.deliveryType,
    now: new Date().toISOString(),
  });
  if (!quote.available) {
    if (request.orderType === "online") {
      throw new BusinessLogicError(
        request.deliveryType === "home" ? "Home delivery is not available there" : "Stop-desk delivery is not available there",
        ERROR_CODES.DELIVERY_NOT_AVAILABLE,
        { wilayaId: request.wilayaId, communeId: request.communeId ?? null, deliveryType: request.deliveryType },
      );
    }
    return { deliveryFee: 0, deliveryOfferId: null, deliveryOfferName: null };
  }
  const offer = quote.free?.by === "offer" ? quote.free : null;
  return { deliveryFee: quote.fee, deliveryOfferId: offer?.offerId ?? null, deliveryOfferName: offer?.offerName ?? null };
}
