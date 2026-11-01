import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, HELP, SECTION } from "../labels";
import { copyOverrides, schemeField, styleField } from "../shared";
import ContactMain from "@/theme/components/contact/ContactMain.astro";

/**
 * How a shopper reaches the store: its WhatsApp (the App's), its phone, email
 * and address (the store's own details), each shown once the merchant has
 * set it. Opening hours and a note are the merchant's, in each language, and
 * show only once written: the theme never claims hours a store does not keep.
 */
export const contactMain = defineComponent({
  type: "contact-main",
  capabilities: { surfaces: ["contact"] },
  component: ContactMain,
  label: SECTION.contactMain,
  group: GROUP.store,
  placement: "section",
  fields: [
    { key: "contactTitle", kind: "text", label: FIELD.title, contentKey: "contactTitle" },
    { key: "contactIntro", kind: "textarea", label: FIELD.intro, contentKey: "contactIntro" },
    { key: "hours", kind: "text", label: FIELD.hours, description: HELP.hours },
    { key: "note", kind: "textarea", label: FIELD.contactNote },
    { key: "showStorePages", kind: "boolean", label: FIELD.showStorePages, default: true },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s7", lg: "s9" }, paddingBlockEnd: { base: "s8", lg: "s10" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => ({ content: copyOverrides(context.content, props) }),
});
