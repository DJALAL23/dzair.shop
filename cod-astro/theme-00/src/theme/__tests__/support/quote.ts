/**
 * A cart quote as the server answers it: every line names its product, its
 * variant, its offer and its share of the coupon; every gift its offer and
 * variant; free delivery says why; the coupon is null without one. A test
 * gives only what its case is about.
 */
type Fields = Record<string, unknown>;

export function serverQuote(body: Fields): Fields {
  const lines = ((body.lines ?? []) as Fields[]).map((line) => ({ productName: String(line.productId), variantId: null, variantLabel: null, offerId: null, offerName: null, discount: 0, maxQuantity: null, blocker: null, ...line }));
  const rewards = ((body.rewards ?? []) as Fields[]).map((reward) => ({ offerName: null, productName: null, variantId: null, variantLabel: null, ...reward }));
  const coupon = (body.coupon ?? null) as Fields | null;
  const free = (body.freeDelivery ?? { fromOffer: false, threshold: null, qualified: false, remaining: 0 }) as Fields;
  const by = free.fromOffer ? "offer" : coupon?.applied && coupon.freeShipping ? "coupon" : free.qualified ? "threshold" : null;
  return { subtotal: 0, ...body, lines, rewards, freeDelivery: { by, ...free }, coupon };
}
