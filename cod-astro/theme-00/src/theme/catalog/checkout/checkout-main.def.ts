import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import { copyOverrides, schemeField, styleField } from "../shared";
import CheckoutMain from "@/theme/components/checkout/CheckoutMain.astro";

/**
 * The basket's checkout: what the basket holds, re-priced by the server, and
 * the order form — the shopper's details, the code by SMS when the store asks
 * for one, a coupon. The title is the merchant's.
 */
export const checkoutMain = defineComponent({
  type: "checkout-main",
  capabilities: { surfaces: ["checkout"] },
  component: CheckoutMain,
  label: SECTION.checkoutMain,
  group: GROUP.store,
  placement: "section",
  fields: [
    { key: "checkoutTitle", kind: "text", label: FIELD.title, contentKey: "checkoutTitle" },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s5", lg: "s6" }, paddingBlockEnd: { base: "s8", lg: "s10" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => ({ content: copyOverrides(context.content, props) }),
});
