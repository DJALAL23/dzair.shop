import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import { copyOverrides, schemeField, styleField } from "../shared";
import ThankYouMain from "@/theme/components/thank-you/ThankYouMain.astro";

/** The order number the editor's preview shows, where no order was placed. */
const EXAMPLE_ORDER = "ORD-20261023-0042";

/**
 * The order's confirmation: its number and total, how it is paid, the three
 * steps that follow, and the ways on. The words, the steps and the tracking
 * link are the merchant's. The route hands it the order its link names.
 */
export const thankYouMain = defineComponent({
  type: "thank-you-main",
  capabilities: { surfaces: ["thank-you"] },
  component: ThankYouMain,
  label: SECTION.thankYouMain,
  group: GROUP.page,
  placement: "section",
  fields: [
    { key: "thankYouTitle", kind: "text", label: FIELD.title, contentKey: "thankYouTitle" },
    { key: "thankYouSubtitle", kind: "textarea", label: FIELD.subtitle, contentKey: "thankYouSubtitle" },
    { key: "codNote", kind: "textarea", label: FIELD.paymentNote, contentKey: "codNote" },
    { key: "showSteps", kind: "boolean", label: FIELD.showSteps, default: true },
    { key: "step1Title", kind: "text", label: FIELD.stepTitle(1), contentKey: "step1Title", visibleIf: { field: "showSteps", equals: true } },
    { key: "step1Sub", kind: "text", label: FIELD.stepText(1), contentKey: "step1Sub", visibleIf: { field: "showSteps", equals: true } },
    { key: "step2Title", kind: "text", label: FIELD.stepTitle(2), contentKey: "step2Title", visibleIf: { field: "showSteps", equals: true } },
    { key: "step2Sub", kind: "text", label: FIELD.stepText(2), contentKey: "step2Sub", visibleIf: { field: "showSteps", equals: true } },
    { key: "step3Title", kind: "text", label: FIELD.stepTitle(3), contentKey: "step3Title", visibleIf: { field: "showSteps", equals: true } },
    { key: "step3Sub", kind: "text", label: FIELD.stepText(3), contentKey: "step3Sub", visibleIf: { field: "showSteps", equals: true } },
    { key: "showTrackOrder", kind: "boolean", label: FIELD.showTrackOrder, default: true },
    { key: "backToStore", kind: "text", label: FIELD.button, contentKey: "backToStore" },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s7", lg: "s9" }, paddingBlockEnd: { base: "s7", lg: "s9" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => {
    const params = context.params ?? {};
    const total = params.total ? Number(params.total) : NaN;
    return {
      content: copyOverrides(context.content, props),
      order: { number: params.orderNumber || EXAMPLE_ORDER, total: Number.isFinite(total) ? total : null },
    };
  },
});
