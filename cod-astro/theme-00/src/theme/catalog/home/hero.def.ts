import { defineComponent } from "@codflow/theme";
import Hero from "@/theme/components/home/Hero.astro";
import { copyOverrides } from "../shared";

export const hero = defineComponent({
  type: "hero",
  component: Hero,
  label: "Hero",
  group: "Home",
  fields: [
    { key: "heroEyebrow", kind: "text", label: "Eyebrow", contentKey: "heroEyebrow" },
    { key: "heroTitle", kind: "text", label: "Title", contentKey: "heroTitle" },
    { key: "heroSubtitle", kind: "textarea", label: "Subtitle", contentKey: "heroSubtitle" },
    { key: "heroCtaPrimary", kind: "text", label: "Primary button", contentKey: "heroCtaPrimary" },
    { key: "heroCtaSecondary", kind: "text", label: "Secondary button", contentKey: "heroCtaSecondary" },
    { key: "ctaPrimaryHref", kind: "url", label: "Primary button link", default: "/products" },
    { key: "ctaSecondaryHref", kind: "url", label: "Secondary button link", default: "#best-sellers" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});