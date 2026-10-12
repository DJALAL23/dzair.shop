import { defineComponent } from "@codflow/theme";
import FeaturesBar from "@/theme/components/home/FeaturesBar.astro";
import { copyOverrides } from "../shared";

export const featuresBar = defineComponent({
  type: "features-bar",
  component: FeaturesBar,
  label: "Features bar",
  group: "Home",
  fields: [
    { key: "feature1Title", kind: "text", label: "Feature 1", contentKey: "feature1Title" },
    { key: "feature2Title", kind: "text", label: "Feature 2", contentKey: "feature2Title" },
    { key: "feature3Title", kind: "text", label: "Feature 3", contentKey: "feature3Title" },
    { key: "feature5Title", kind: "text", label: "Feature 4", contentKey: "feature5Title" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});