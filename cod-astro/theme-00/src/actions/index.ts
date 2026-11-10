// Astro requires actions in src/actions/index.ts. This file is framework
// wiring only: the action name, the form acceptance and the SDK's input
// whitelist. Everything decision-bearing — the whitelist, the
// basket-or-product rule, attribution forwarding, the wire body and what each
// answer means — lives in @wocart/storefront/astro. A refused order is an
// answer the page words (theme/pages/order-outcome.ts), not a failure.
import { defineAction } from "astro:actions";
import { lookupOrder, orderLookupInput, placeOrder, placeOrderInput } from "@wocart/storefront/astro";
import { getStoreClient } from "@/theme/sdk";

export const server = {
  placeOrder: defineAction({
    accept: "form",
    input: placeOrderInput,
    handler: (input, context) => placeOrder(input, context.request, getStoreClient()),
  }),

  // A shopper following an order: the SDK words the outcome, and what was
  // asked comes back so a refused form keeps it.
  orderStatus: defineAction({
    accept: "form",
    input: orderLookupInput,
    handler: async (input, context) => ({ asked: input, lookup: await lookupOrder(input, context.request, getStoreClient()) }),
  }),
};
