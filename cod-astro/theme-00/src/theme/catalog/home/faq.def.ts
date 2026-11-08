import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import Faq from "@/theme/components/home/Faq.astro";
import { copyOverrides, schemeField, styleField } from "../shared";

/** Enough for a real FAQ; past this a page is a help center, not a section. */
const MAX_QUESTIONS = 20;

const paragraph = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const paragraphs = (ar: string, fr: string, en: string) => ({ ar: paragraph(ar), fr: paragraph(fr), en: paragraph(en) });


export const faq = defineComponent({
  type: "faq",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "thank-you", "track-order", "contact"] },
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
  presets: [
    {
      key: "cash-on-delivery",
      label: { ar: "أسئلة الدفع عند الاستلام", fr: "Questions sur le paiement à la livraison", en: "Cash-on-delivery questions" },
      props: {
        questions: [
          { id: "pay", props: { question: { ar: "كيف أدفع؟", fr: "Comment je paie ?", en: "How do I pay?" }, answer: paragraphs("نقدًا عند استلام طلبك. لا شيء تدفعه الآن.", "En espèces, à la livraison. Rien à payer maintenant.", "In cash, when your order arrives. Nothing to pay now.") } },
          {
            id: "when",
            props: {
              question: { ar: "متى يصلني الطلب؟", fr: "Quand serai-je livré ?", en: "When will it arrive?" },
              answer: paragraphs(
                "نتصل بك لتأكيد الطلب ثم نرسله إلى ولايتك، عادةً خلال 2 إلى 5 أيام حسب الولاية.",
                "Nous vous appelons pour confirmer, puis nous expédions vers votre wilaya : en général 2 à 5 jours selon la wilaya.",
                "We call you to confirm, then ship to your wilaya: usually 2 to 5 days, depending on the wilaya.",
              ),
            },
          },
          { id: "where", props: { question: { ar: "هل توصلون إلى ولايتي؟", fr: "Livrez-vous dans ma wilaya ?", en: "Do you deliver to my wilaya?" }, answer: paragraphs("نوصل عبر كامل الجزائر، إلى باب المنزل أو إلى مكتب شركة التوصيل.", "Nous livrons partout en Algérie, à domicile ou au bureau du transporteur.", "We deliver across Algeria, to your door or to the carrier's office.") } },
          { id: "exchange", props: { question: { ar: "وإذا لم يناسبني؟", fr: "Et si ça ne convient pas ?", en: "What if it does not suit me?" }, answer: paragraphs("تواصل معنا بعد الاستلام ونجد معك الحل المناسب.", "Contactez-nous après réception et nous trouvons ensemble une solution.", "Contact us after it arrives and we will find a solution together.") } },
        ],
      },
    },
  ],
});
