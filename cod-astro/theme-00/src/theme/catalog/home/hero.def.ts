import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import Hero from "@/theme/components/home/Hero.astro";
import { SCHEME_OF } from "@/theme/appearance";
import { collectionRead, copyOverrides, schemeField, styleField } from "../shared";

/** A few products are read so the first one with a photo, in stock, can lead. */
const HERO_READ = 6;

/**
 * The page's first view: a large photo — the merchant's own, else the first
 * product of a collection — beside the store's promise and two actions.
 */
export const hero = defineComponent({
  type: "hero",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: Hero,
  label: SECTION.hero,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "heroTitle", kind: "text", label: FIELD.title, contentKey: "heroTitle" },
    { key: "heroSubtitle", kind: "textarea", label: FIELD.subtitle, contentKey: "heroSubtitle" },
    { key: "heroCtaPrimary", kind: "text", label: FIELD.primaryButton, contentKey: "heroCtaPrimary" },
    { key: "ctaPrimaryHref", kind: "url", label: FIELD.primaryButtonLink, default: "/products" },
    { key: "heroCtaSecondary", kind: "text", label: FIELD.secondaryButton, contentKey: "heroCtaSecondary" },
    { key: "ctaSecondaryHref", kind: "url", label: FIELD.secondaryButtonLink, default: "#best-sellers" },
    { key: "image", kind: "image", label: FIELD.photo },
    { key: "collection", kind: "collection", label: FIELD.photoFallback, default: "featured" },
    {
      key: "photoSide",
      kind: "select",
      label: FIELD.photoSide,
      options: ["end", "start"],
      optionLabels: { end: OPTION.end, start: OPTION.start },
      default: "end",
      display: "segmented",
    },
    schemeField(SCHEME_OF.sand),
    styleField({ size: { width: { base: "full" } } }),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const products = props.image
      ? []
      : await reads.get(collectionRead(props.collection, HERO_READ), () => storefront.products.list({ collection: props.collection, limit: HERO_READ }));
    const lead = products.find((product) => product.coverImage && product.inventory !== 0) ?? products.find((product) => product.coverImage) ?? null;
    return {
      lead: lead ? { src: lead.coverImage!.url, alt: lead.coverImage!.altText ?? lead.name } : null,
      content: copyOverrides(context.content, props),
    };
  },
});
