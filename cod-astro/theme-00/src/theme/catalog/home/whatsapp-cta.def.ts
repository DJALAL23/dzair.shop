import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import WhatsAppCTA from "@/theme/components/home/WhatsAppCTA.astro";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, schemeField, sectionSpacing, styleField } from "../shared";

export const whatsappCta = defineComponent({
  type: "whatsapp-cta",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "thank-you", "track-order", "area:footer"] },
  component: WhatsAppCTA,
  label: SECTION.whatsappCta,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "promoTitle", kind: "text", label: FIELD.title, contentKey: "promoTitle" },
    { key: "promoSub", kind: "textarea", label: FIELD.subtitle, contentKey: "promoSub" },
    { key: "promoCtaText", kind: "text", label: FIELD.button, contentKey: "promoCtaText" },
    { key: "ctaHref", kind: "url", label: FIELD.buttonLink, default: "/products" },
    schemeField(SCHEME_OF.night),
    styleField(sectionSpacing(true)),
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
});