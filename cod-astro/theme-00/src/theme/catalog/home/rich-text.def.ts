import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import RichTextBlock from "@/theme/components/home/RichTextBlock.astro";
import { copyOverrides, schemeField, styleField } from "../shared";

const paragraph = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

export const richText = defineComponent({
  type: "rich-text",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "thank-you", "search", "track-order", "checkout", "contact", "area:footer"] },
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
  presets: [
    {
      key: "satisfaction",
      label: { ar: "رضاك أولًا", fr: "Votre satisfaction", en: "Your satisfaction" },
      props: {
        richTextTitle: { ar: "رضاك قبل كل شيء", fr: "Votre satisfaction d'abord", en: "Your satisfaction first" },
        body: {
          ar: paragraph("إن لم يصلك طلبك كما توقعت، تواصل معنا ونجد لك الحل."),
          fr: paragraph("Si votre commande n'est pas comme prévu, écrivez-nous et nous trouvons une solution."),
          en: paragraph("If your order is not what you expected, contact us and we will find a solution."),
        },
      },
    },
  ],
});
