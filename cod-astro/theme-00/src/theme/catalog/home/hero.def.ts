import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import Hero from "@/theme/components/home/Hero.astro";
import { CATALOG_READ, copyOverrides } from "../shared";

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
    { key: "trust1Title", kind: "text", label: FIELD.trustTitle(1), contentKey: "trust1Title" },
    { key: "trust1Sub", kind: "text", label: FIELD.trustSub(1), contentKey: "trust1Sub" },
    { key: "trust2Title", kind: "text", label: FIELD.trustTitle(2), contentKey: "trust2Title" },
    { key: "trust2Sub", kind: "text", label: FIELD.trustSub(2), contentKey: "trust2Sub" },
    { key: "trust3Title", kind: "text", label: FIELD.trustTitle(3), contentKey: "trust3Title" },
    { key: "trust3Sub", kind: "text", label: FIELD.trustSub(3), contentKey: "trust3Sub" },
  ],
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});