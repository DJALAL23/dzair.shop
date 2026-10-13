import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import Hero from "@/theme/components/home/Hero.astro";
import { copyOverrides } from "../shared";

export const hero = defineComponent({
  type: "hero",
  component: Hero,
  label: SECTION.hero,
  group: GROUP.home,
  fields: [
    { key: "heroEyebrow", kind: "text", label: FIELD.eyebrow, contentKey: "heroEyebrow" },
    { key: "heroTitle", kind: "text", label: FIELD.title, contentKey: "heroTitle" },
    { key: "heroSubtitle", kind: "textarea", label: FIELD.subtitle, contentKey: "heroSubtitle" },
    { key: "heroCtaPrimary", kind: "text", label: FIELD.primaryButton, contentKey: "heroCtaPrimary" },
    { key: "heroCtaSecondary", kind: "text", label: FIELD.secondaryButton, contentKey: "heroCtaSecondary" },
    { key: "ctaPrimaryHref", kind: "url", label: FIELD.primaryButtonLink, default: "/products" },
    { key: "ctaSecondaryHref", kind: "url", label: FIELD.secondaryButtonLink, default: "#best-sellers" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});