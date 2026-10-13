// Astro requires actions in src/actions/index.ts. This file is framework
// wiring only: the action name, the form acceptance, the SDK's input
// whitelist, and turning the SDK engine's result into an ActionError (shape
// failures) or an Error (upstream refusals). Everything decision-bearing —
// the whitelist, the basket-or-product rule, attribution forwarding, the wire
// body — lives in @wocart/storefront/astro (S8).
import { ActionError, defineAction } from "astro:actions";
import { executePlaceOrder, placeOrderInput } from "@wocart/storefront/astro";
import { getStoreClient } from "@/theme/sdk";

export const server = {
  placeOrder: defineAction({
    accept: "form",
    input: placeOrderInput,
    handler: async (input, context) => {
      const result = await executePlaceOrder(
        input,
        context.request,
        getStoreClient(),
      );

      if (!result.success) {
        // "shape" — neither a basket nor a product — is a field error the
        // form can render. Anything else is the store refusing the order: a
        // 422, so the page reads as a refusal and not a crash. The message is
        // cod-server's, written for the merchant; the form shows the store's own
        // sentence instead (see orderOutcome).
        if (result.errorKind === "shape") {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: result.error,
          });
        }
        throw new ActionError({
          code: "UNPROCESSABLE_CONTENT",
          message: result.error,
        });
      }

      return result.data;
    },
  }),
};