import { defineComponent } from "@codflow/theme";
import HowItWorks from "@/theme/components/home/HowItWorks.astro";
import { copyOverrides } from "../shared";

export const howItWorks = defineComponent({
  type: "how-it-works",
  component: HowItWorks,
  label: "How it works",
  group: "Home",
  fields: [
    { key: "howItWorksTitle", kind: "text", label: "Title", contentKey: "howItWorksTitle" },
    { key: "howItWorksSub", kind: "textarea", label: "Subtitle", contentKey: "howItWorksSub" },
    { key: "howStep1Title", kind: "text", label: "Step 1 title", contentKey: "howStep1Title" },
    { key: "howStep1Sub", kind: "textarea", label: "Step 1 text", contentKey: "howStep1Sub" },
    { key: "howStep2Title", kind: "text", label: "Step 2 title", contentKey: "howStep2Title" },
    { key: "howStep2Sub", kind: "textarea", label: "Step 2 text", contentKey: "howStep2Sub" },
    { key: "howStep3Title", kind: "text", label: "Step 3 title", contentKey: "howStep3Title" },
    { key: "howStep3Sub", kind: "textarea", label: "Step 3 text", contentKey: "howStep3Sub" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});