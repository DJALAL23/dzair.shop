/**
 * Basket rendering, shared by the cart drawer and the checkout page.
 *
 * Both surfaces show the same thing — the same lines, the same server verdict,
 * the same free-delivery progress — in two different frames. The markup they
 * clone differs; the contract does not, and it is the contract that matters:
 * every row exposes the same `data-cart-*` hooks, so one renderer fills both.
 *
 * The alternative was two copies of "which line did the server mark
 * out of stock", and two chances for the drawer and the checkout page to tell
 * a shopper different things about the same basket.
 */

import { embeddedMessage, embeddedTemplate } from "@/theme/content/messages";
import { getCart, lineKey, setQuantity, removeLine, toOrderItems, type BasketLine } from "./cart";
import { createQuoter, type CartValidation, type CartValidationLine, type DeliveryDestination } from "@wocart/storefront";
import { formatAmount, formatCurrency } from "../utils/money";
import { STOREFRONT_API_PATHS } from "@wocart/storefront";

/** The server's verdict on the basket — the SDK schema's types, not a mirror of them. */
export type ValidatedLine = CartValidationLine;
export type ValidationResult = CartValidation;

export interface LineCopy {
  outOfStock: string;
  unavailable: string;
}

export interface FreeDeliveryCopy {
  earned: string;
  remaining: string;
}



/** Curried once per page; the formatting itself is the SDK's one money function. */
export function moneyFormatter(currency: string): (n: number) => string {
  return (n) => formatCurrency(n, currency);
}

/**
 * Asks the server for the truth about a basket — and, given a destination,
 * what delivering it there costs (`delivery`, the order's own quote).
 *
 * The SDK's quoter keeps only the latest answer, so the shopper tapping `+`
 * three times ends on the third answer, not on whichever lands last.
 * `undefined` means nothing to apply (stale, offline, blocked — the basket
 * still works from local state, and checkout re-checks everything); `null`
 * means the basket is known to be empty.
 */
export function createValidator(endpoint: string = STOREFRONT_API_PATHS.cartValidate) {
  const quoter = createQuoter({ endpoint });

  return async function validate(
    lines: BasketLine[],
    destination?: DeliveryDestination,
    /** The code applied at checkout, and the phone typed — the drawer asks with neither. */
    asks: { couponCode?: string; phone?: string } = {},
  ): Promise<ValidationResult | null | undefined> {
    if (lines.length === 0) return null;
    const answer = await quoter.quote({ items: toOrderItems(lines) }, { ...(destination ? { destination } : {}), ...asks });
    return answer.status === "fresh" ? answer.quote : undefined;
  };
}

export function validatedByKey(result: ValidationResult | null): Map<string, ValidatedLine> {
  return new Map((result?.lines ?? []).map((l) => [lineKey(l.productId, l.variantId), l]));
}

/** Whether anything in the basket can no longer be ordered. */
export function hasBlocker(result: ValidationResult | null): boolean {
  return (result?.lines ?? []).some((l) => l.blocker !== null);
}

/** The offers that give a gift. A line one of them prices is a deal, and its quantity is the deal's. */
export function giftOfferIds(result: ValidationResult | null): Set<string> {
  return new Set((result?.rewards ?? []).map((reward) => reward.offerId));
}

/**
 * Clone one row and fill it.
 *
 * Warnings come from the server pass only: the optimistic render never invents
 * a problem it has not been told about.
 */
export function renderCartLine(
  template: HTMLTemplateElement,
  line: BasketLine,
  server: ValidatedLine | undefined,
  copy: LineCopy,
  money: (n: number) => string,
  options: { linkToProduct?: boolean; giftOffers?: ReadonlySet<string> } = {},
): HTMLElement {
  const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  node.dataset.key = lineKey(line.productId, line.variantId);

  const img = node.querySelector<HTMLImageElement>("[data-cart-image]");
  if (img && line.image) {
    img.src = line.image;
    img.hidden = false;
  }

  // The server's names are the catalog's, in this page's language; the
  // basket's are whatever page the line was added on.
  const name = node.querySelector<HTMLElement>("[data-cart-name]")!;
  name.textContent = server?.productName ?? line.productName;

  // The drawer links back to the product; the checkout page does not. Sending
  // a shopper away from a half-filled order form loses what they typed, and on
  // that page their job is to finish, not to browse.
  if (options.linkToProduct && line.href) {
    const imageLink = node.querySelector<HTMLAnchorElement>("[data-cart-image-link]");
    if (name instanceof HTMLAnchorElement) name.href = line.href;
    if (imageLink) imageLink.href = line.href;
  }

  const variantEl = node.querySelector<HTMLElement>("[data-cart-variant]")!;
  const variantLabel = server?.variantLabel ?? line.variantLabel;
  if (variantLabel) {
    variantEl.textContent = variantLabel;
    variantEl.hidden = false;
  }

  const offer = node.querySelector<HTMLElement>("[data-cart-offer]");
  if (offer && server?.offerName) {
    offer.textContent = server.offerName;
    offer.hidden = false;
  }

  // A line priced by an offer that gives a gift is a deal: its quantity is the
  // deal's, so it shows without a stepper, and removing it removes the whole
  // deal (bindLineControls). A quantity tier or a free-delivery offer gives no
  // gift, so its line keeps the stepper, and the server re-prices every step
  // up the tiers.
  const deal = server?.offerId && options.giftOffers?.has(server.offerId) ? server.offerId : null;
  if (deal) {
    node.dataset.offerId = deal;
    const stepper = node.querySelector<HTMLElement>("[data-cart-stepper]");
    const fixed = node.querySelector<HTMLElement>("[data-cart-qty-fixed]");
    if (stepper && fixed) {
      stepper.hidden = true;
      fixed.textContent = `×${line.quantity}`;
      fixed.hidden = false;
    }
  }

  const { total, was } = linePrice(line, server);
  node.querySelector("[data-cart-qty]")!.textContent = String(line.quantity);
  node.querySelector("[data-cart-total]")!.textContent = money(total);
  const wasEl = node.querySelector<HTMLElement>("[data-cart-was]");
  if (wasEl && was !== null) {
    wasEl.textContent = money(was);
    wasEl.hidden = false;
  }

  const warn = node.querySelector<HTMLElement>("[data-cart-warning]")!;
  if (server?.blocker === "out_of_stock" && server.maxQuantity != null) {
    warn.textContent = embeddedMessage(copy.outOfStock, "cartLineOutOfStock", { count: server.maxQuantity });
    warn.hidden = false;
  } else if (server?.blocker) {
    warn.textContent = copy.unavailable;
    warn.hidden = false;
  }

  const increase = node.querySelector<HTMLButtonElement>("[data-cart-increase]")!;
  if (server?.maxQuantity != null && line.quantity >= server.maxQuantity) {
    increase.disabled = true;
  }

  return node;
}

/**
 * What a row shows for its price: the server's line total before the coupon
 * (the coupon has its own row), and the catalog price struck through when an
 * offer brought it down. Until the server answers, the basket's own price.
 */
export function linePrice(line: BasketLine, server: ValidatedLine | undefined): { total: number; was: number | null } {
  const atCatalog = (server?.unitPrice ?? line.unitPrice) * line.quantity;
  if (!server) return { total: atCatalog, was: null };
  const total = server.lineTotal + (server.discount ?? 0);
  return { total, was: total < atCatalog ? atCatalog : null };
}

/**
 * The gifts the basket earns, one row each, as the order will give them —
 * product, variant and the offer that gives it. None until the server answers.
 */
export function renderCartRewards(template: HTMLTemplateElement, result: ValidationResult | null): HTMLElement[] {
  return (result?.rewards ?? []).flatMap((reward) => {
    if (!reward.productName) return [];
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.querySelector("[data-reward-name]")!.textContent = reward.productName;
    for (const [hook, text] of [["[data-reward-variant]", reward.variantLabel], ["[data-reward-offer]", reward.offerName]] as const) {
      const el = node.querySelector<HTMLElement>(hook)!;
      if (text) {
        el.textContent = text;
        el.hidden = false;
      }
    }
    node.querySelector("[data-reward-qty]")!.textContent = `×${reward.quantity}`;
    return [node];
  });
}

/**
 * Quantity and remove controls, by delegation on the list.
 *
 * Delegation rather than per-row listeners because the rows are replaced
 * wholesale on every render; the list element itself is stable.
 */
export function bindLineControls(
  list: HTMLElement,
  onChange: () => void,
  signal?: AbortSignal,
): void {
  list.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-cart-line]");
      if (!row?.dataset.key) return;
      const key = row.dataset.key;
      const current = getCart().find((l) => lineKey(l.productId, l.variantId) === key);
      if (!current) return;

      if (target.closest("[data-cart-remove]")) {
        const offerId = row.dataset.offerId;
        const deal = offerId ? [...list.querySelectorAll<HTMLElement>("[data-cart-line]")].filter((other) => other.dataset.offerId === offerId) : [row];
        for (const member of deal) if (member.dataset.key) removeLine(member.dataset.key);
      } else if (target.closest("[data-cart-increase]")) {
        setQuantity(key, current.quantity + 1);
      } else if (target.closest("[data-cart-decrease]")) {
        setQuantity(key, current.quantity - 1);
      } else {
        return;
      }
      onChange();
    },
    { signal },
  );
}

/**
 * Free-delivery progress, or nothing when the merchant set no threshold.
 *
 * `qualified` comes from the server rather than being inferred from the
 * subtotal, because an offer can grant free delivery without one.
 */
export function renderFreeDelivery(
  elements: { wrap: HTMLElement | null; text: HTMLElement | null; bar: HTMLElement | null },
  result: ValidationResult | null,
  subtotal: number,
  copy: FreeDeliveryCopy,
  currency: string,
): void {
  const { wrap, text, bar } = elements;
  const info = result?.freeDelivery;
  if (!wrap || !text || !bar || !info || info.threshold == null) {
    if (wrap) wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  // The state attribute is the whole contract with the stylesheet: the icon,
  // the colour and whether the stripes keep moving all follow from it. See
  // FreeDeliveryBar.astro.
  wrap.dataset.state = info.qualified ? "earned" : "progress";

  if (info.qualified) {
    text.textContent = copy.earned;
    bar.style.width = "100%";
    return;
  }

  text.textContent = embeddedTemplate(copy.remaining, {
    // Number only: the copy template owns the symbol's place in the sentence,
    // and the formatting still goes through the SDK's one money function.
    amount: formatAmount(info.remaining),
    currency,
  });
  bar.style.width = `${Math.max(0, Math.min(100, (subtotal / info.threshold) * 100))}%`;
}
