/**
 * Which offers a basket earns, and what they do to it.
 *
 * Pure: no database, no clock. The catalog snapshot loads the candidates
 * (active, in schedule) with their tiers; the order engine and the cart quote
 * both call `applyOffers`, so what the shopper is shown and what the order
 * charges cannot drift apart.
 *
 * The rules, and why each one is what it is:
 *
 *  1. A product is judged by the units it counts: every line of it, across
 *     variants — two sizes of one shirt are two shirts — or only the variant
 *     an offer is locked to.
 *  2. One offer per product. Among those a product qualifies for, the
 *     shopper's choice (`offerId`) wins when it qualifies on its own; else the
 *     highest threshold reached wins, the id breaking a tie so every run
 *     agrees.
 *  3. Quantity pricing prices the counted lines at the highest tier reached:
 *     exactly the tier's price at its quantity, its per-unit price beyond.
 *     The total is shared across the lines by their quantities so the lines
 *     add up to it to the dinar.
 *  4. A reward is given once per order, whatever the quantity. Rewards are output,
 *     never input: a reward unit never counts toward another offer.
 *  5. Free delivery — a free-shipping offer, or a tier that includes it —
 *     applies only to a basket of one product. In a mixed basket free delivery
 *     is the store's threshold's business; otherwise a cheap promoted item
 *     would ship a large basket for free.
 *  6. Only an offer that changed something is reported as applied.
 *  7. Products are judged in basket order, so a basket always comes out the
 *     same.
 */
import { tierFor, tieredTotal, type OfferKind, type PriceTier } from "./model";

/** An offer as the engine reads it. */
export interface EngineOffer {
  id: string;
  discountType: OfferKind;
  triggerProductId: string;
  triggerVariantId: string | null;
  triggerQuantity: number;
  rewardProductId: string | null;
  rewardVariantId: string | null;
  rewardQuantity: number;
  /** Quantity pricing's tiers; empty for the other kinds. */
  tiers: readonly PriceTier[];
}

/** A basket line as the engine reads it: what is bought, and its catalog unit price. */
export interface OfferLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  /** The offer the shopper picked for this product, if any. */
  offerId?: string;
}

export interface PricedOfferLine {
  /** What the line costs: its catalog price, or the quantity-pricing tier's. */
  lineTotal: number;
  /** The quantity-pricing offer that set `lineTotal`; null at the catalog price. */
  offerId: string | null;
}

export interface EarnedReward<L extends OfferLine = OfferLine> {
  offer: EngineOffer;
  /** The first counted line: a reward of the same product mirrors its variant. */
  line: L;
}

export interface AppliedOffers<L extends OfferLine = OfferLine> {
  /** One per input line, in order. */
  lines: PricedOfferLine[];
  rewards: EarnedReward<L>[];
  /** The offer that made delivery free, or null. */
  freeShippingOfferId: string | null;
}

function counted<L extends OfferLine>(lines: readonly L[], offer: EngineOffer): L[] {
  return lines.filter((line) => line.productId === offer.triggerProductId && (!offer.triggerVariantId || line.variantId === offer.triggerVariantId));
}

/** The threshold an offer reaches with `quantity` units, or null when it does not qualify. */
function reached(offer: EngineOffer, quantity: number): number | null {
  if (offer.discountType === "quantity_price") return tierFor(offer.tiers, quantity)?.quantity ?? null;
  return quantity >= offer.triggerQuantity ? offer.triggerQuantity : null;
}

/** `total` shared across lines by their quantities, by largest remainder, so the shares sum to it exactly. */
function share(total: number, quantities: readonly number[]): number[] {
  const units = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const exact = quantities.map((quantity) => (total * quantity) / units);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index]! += 1;
    left -= 1;
  }
  return shares;
}

export function applyOffers<L extends OfferLine>(lines: readonly L[], candidates: readonly EngineOffer[]): AppliedOffers<L> {
  const priced: PricedOfferLine[] = lines.map((line) => ({ lineTotal: line.unitPrice * line.quantity, offerId: null }));
  const rewards: EarnedReward<L>[] = [];
  let freeShippingOfferId: string | null = null;

  const products = [...new Set(lines.map((line) => line.productId))];
  const singleProductBasket = products.length === 1;

  for (const productId of products) {
    const choice = lines.find((line) => line.productId === productId && line.offerId)?.offerId;
    const qualifying = candidates
      .filter((offer) => offer.triggerProductId === productId)
      .map((offer) => {
        const units = counted(lines, offer).reduce((sum, line) => sum + line.quantity, 0);
        return { offer, threshold: reached(offer, units), units };
      })
      .filter((entry): entry is { offer: EngineOffer; threshold: number; units: number } => entry.threshold !== null)
      .sort((a, b) => b.threshold - a.threshold || a.offer.id.localeCompare(b.offer.id));
    const chosen = qualifying.find((entry) => entry.offer.id === choice) ?? qualifying[0];
    if (!chosen) continue;
    const { offer, units } = chosen;
    const lineIndexes = lines.flatMap((line, index) => (counted([line], offer).length ? [index] : []));

    if (offer.discountType === "quantity_price") {
      const tier = tierFor(offer.tiers, units)!;
      const shares = share(tieredTotal(tier, units), lineIndexes.map((index) => lines[index]!.quantity));
      lineIndexes.forEach((index, at) => {
        priced[index] = { lineTotal: shares[at]!, offerId: offer.id };
      });
      if (tier.freeShipping && singleProductBasket) freeShippingOfferId = offer.id;
    } else if (offer.discountType === "free") {
      rewards.push({ offer, line: lines[lineIndexes[0]!]! });
    } else if (singleProductBasket) {
      freeShippingOfferId = offer.id;
    }
  }

  return { lines: priced, rewards, freeShippingOfferId };
}
