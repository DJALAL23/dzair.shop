import { defineComponent } from "@codflow/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import FeaturesBar from "@/theme/components/home/FeaturesBar.astro";
import { copyOverrides } from "../shared";

export const featuresBar = defineComponent({
  type: "features-bar",
  component: FeaturesBar,
  label: SECTION.featuresBar,
  group: GROUP.home,
  fields: [
    { key: "feature1Title", kind: "text", label: FIELD.feature(1), contentKey: "feature1Title" },
    { key: "feature2Title", kind: "text", label: FIELD.feature(2), contentKey: "feature2Title" },
    { key: "feature3Title", kind: "text", label: FIELD.feature(3), contentKey: "feature3Title" },
    { key: "feature5Title", kind: "text", label: FIELD.feature(4), contentKey: "feature5Title" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});