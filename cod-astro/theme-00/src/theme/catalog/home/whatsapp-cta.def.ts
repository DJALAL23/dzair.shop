import { defineComponent } from "@codflow/theme";
import WhatsAppCTA from "@/theme/components/home/WhatsAppCTA.astro";
import { copyOverrides } from "../shared";

export const whatsappCta = defineComponent({
  type: "whatsapp-cta",
  component: WhatsAppCTA,
  label: "WhatsApp CTA",
  group: "Home",
  fields: [
    { key: "promoTitle", kind: "text", label: "Title", contentKey: "promoTitle" },
    { key: "promoSub", kind: "textarea", label: "Subtitle", contentKey: "promoSub" },
    { key: "promoCtaText", kind: "text", label: "Button", contentKey: "promoCtaText" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});