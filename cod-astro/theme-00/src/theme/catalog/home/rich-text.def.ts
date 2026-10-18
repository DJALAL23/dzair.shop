import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import RichTextBlock from "@/theme/components/home/RichTextBlock.astro";
import { copyOverrides } from "../shared";

export const richText = defineComponent({
  type: "rich-text",
  component: RichTextBlock,
  label: SECTION.richText,
  group: GROUP.home,
  fields: [
    { key: "richTextTitle", kind: "text", label: FIELD.title, contentKey: "richTextTitle" },
    { key: "body", kind: "richtext", label: FIELD.text },
    {
      key: "alignment",
      kind: "select",
      label: FIELD.alignment,
      options: ["start", "center"],
      optionLabels: { start: OPTION.start, center: OPTION.center },
      default: "start",
    },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});
