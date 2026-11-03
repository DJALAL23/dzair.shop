/**
 * The thank-you page: the order is placed, so the tab's unfinished checkout
 * is marked converted (the merchant no longer sees it as abandoned) and the
 * basket that produced it is cleared. Cleared here rather than at submit: this
 * page is reached only after the server accepted the order, so a failed
 * submission never loses the shopper's basket.
 */
import { convertAbandonedCheckout } from "@wocart/storefront";
import { onEachPage } from "@wocart/theme/lifecycle";
import { STOREFRONT_API_PATHS } from "@wocart/storefront";
import { clearCart } from "./cart";

onEachPage(() => {
  const placed = document.querySelector<HTMLElement>("[data-order-placed]");
  if (!placed) return;
  convertAbandonedCheckout({ endpoint: STOREFRONT_API_PATHS.abandonedConvert, orderId: placed.dataset.orderId ?? "", orderNumber: placed.dataset.orderNumber ?? "" });
  clearCart();
});
