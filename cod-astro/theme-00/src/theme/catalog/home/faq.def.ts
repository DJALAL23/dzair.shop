import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import Faq from "@/theme/components/home/Faq.astro";
import { PAGE_SURFACES, copyOverrides, schemeField, styleField } from "../shared";

/** Enough for a real FAQ; past this a page is a help center, not a section. */
const MAX_QUESTIONS = 20;

export const faq = defineComponent({
  type: "faq",
  component: Faq,
  label: SECTION.faq,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "faqTitle", kind: "text", label: FIELD.title, contentKey: "faqTitle" },
    {
      key: "questions",
      kind: "list",
      label: FIELD.questions,
      max: MAX_QUESTIONS,
      itemLabel: "question",
      fields: [
        { key: "question", kind: "text", label: FIELD.question },
        { key: "answer", kind: "richtext", label: FIELD.answer, formats: ["bold", "italic", "link", "list"] },
      ],
    },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s6", lg: "s8" }, paddingBlockEnd: { base: "s6", lg: "s8" } }, size: { width: { base: "content" } } }),
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true, surfaces: PAGE_SURFACES },
});
