import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import RichTextBlock from "@/theme/components/home/RichTextBlock.astro";
import { copyOverrides, schemeField, styleField } from "../shared";

export const richText = defineComponent({
  type: "rich-text",
  capabilities: { insertable: true, surfaces: ["home", "page", "area:footer"] },
  component: RichTextBlock,
  label: SECTION.richText,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "richTextTitle", kind: "text", label: FIELD.title, contentKey: "richTextTitle" },
    { key: "body", kind: "richtext", label: FIELD.text },
    {
      key: "alignment",
      kind: "select",
      label: FIELD.alignment,
      options: ["start", "center"],
      optionLabels: { start: OPTION.start, center: OPTION.center },
      default: "center",
      display: "segmented",
    },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s6", lg: "s8" }, paddingBlockEnd: { base: "s6", lg: "s8" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
});
