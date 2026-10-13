import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import HowItWorks from "@/theme/components/home/HowItWorks.astro";
import { copyOverrides } from "../shared";

export const howItWorks = defineComponent({
  type: "how-it-works",
  component: HowItWorks,
  label: SECTION.howItWorks,
  group: GROUP.home,
  fields: [
    { key: "howItWorksTitle", kind: "text", label: FIELD.title, contentKey: "howItWorksTitle" },
    { key: "howItWorksSub", kind: "textarea", label: FIELD.subtitle, contentKey: "howItWorksSub" },
    { key: "howStep1Title", kind: "text", label: FIELD.stepTitle(1), contentKey: "howStep1Title" },
    { key: "howStep1Sub", kind: "textarea", label: FIELD.stepText(1), contentKey: "howStep1Sub" },
    { key: "howStep2Title", kind: "text", label: FIELD.stepTitle(2), contentKey: "howStep2Title" },
    { key: "howStep2Sub", kind: "textarea", label: FIELD.stepText(2), contentKey: "howStep2Sub" },
    { key: "howStep3Title", kind: "text", label: FIELD.stepTitle(3), contentKey: "howStep3Title" },
    { key: "howStep3Sub", kind: "textarea", label: FIELD.stepText(3), contentKey: "howStep3Sub" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});