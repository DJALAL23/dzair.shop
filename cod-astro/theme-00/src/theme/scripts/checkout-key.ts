/**
 * One checkout, one order: every order form on the page (`form[data-checkout]`)
 * carries the SDK's checkout key, so a double click, a refresh or a retry is
 * answered with the order already placed instead of placing it again.
 */

import { bindCheckoutKey } from "@wocart/storefront";
import { onEachPage } from "@wocart/theme/lifecycle";

export function bindCheckoutForms(root: ParentNode = document): () => void {
  const unbinds = Array.from(root.querySelectorAll<HTMLFormElement>("form[data-checkout]"), (form) => bindCheckoutKey(form));
  return () => unbinds.forEach((unbind) => unbind());
}

onEachPage(() => bindCheckoutForms());
