import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, HELP, OPTION, SECTION } from "../labels";
import ImageBanner from "@/theme/components/home/ImageBanner.astro";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, onSaleRead, schemeField, styleField } from "../shared";

/** Products on sale read to lend a photo to a banner without one of its own. */
// The tabs' default count, so a page with both reads the sale once.
const SALE_READ = 8;

/**
 * A promotion: a large photo — the merchant's own, else a product on sale —
 * beside a tag, a title, a few lines, an optional countdown and one action.
 */
export const imageBanner = defineComponent({
  type: "image-banner",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "contact"] },
  component: ImageBanner,
  label: SECTION.imageBanner,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "image", kind: "image", label: FIELD.image },
    {
      key: "imageSide",
      kind: "select",
      label: FIELD.imageSide,
      options: ["start", "end"],
      optionLabels: { start: OPTION.start, end: OPTION.end },
      default: "end",
      display: "segmented",
    },
    { key: "bannerTag", kind: "text", label: FIELD.tag, contentKey: "bannerTag" },
    { key: "bannerTitle", kind: "text", label: FIELD.title, contentKey: "bannerTitle" },
    { key: "bannerSub", kind: "textarea", label: FIELD.subtitle, contentKey: "bannerSub" },
    { key: "body", kind: "richtext", label: FIELD.text, formats: ["bold", "italic", "link"] },
    {
      key: "countdown",
      kind: "select",
      label: FIELD.countdown,
      options: ["none", "midnight", "date"],
      optionLabels: { none: OPTION.none, midnight: OPTION.midnight, date: OPTION.onDate },
      default: "none",
      display: "segmented",
    },
    { key: "endsOn", kind: "text", label: FIELD.endsOn, description: HELP.endsOn, visibleIf: { field: "countdown", equals: "date" } },
    { key: "endsAt", kind: "text", label: FIELD.endsAt, description: HELP.endsAt, visibleIf: { field: "countdown", equals: "date" } },
    { key: "bannerCta", kind: "text", label: FIELD.button, contentKey: "bannerCta" },
    { key: "ctaHref", kind: "url", label: FIELD.buttonLink, default: "/products" },
    schemeField(SCHEME_OF.sand),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const onSale = props.image ? [] : await reads.get(onSaleRead(SALE_READ), () => storefront.products.list({ onSale: true, limit: SALE_READ }));
    // The second product with a photo, when there is one: the first often
    // already leads the page's first view.
    const withPhoto = onSale.filter((product) => product.coverImage);
    const lead = withPhoto[1] ?? withPhoto[0] ?? null;
    return {
      lead: lead ? { src: lead.coverImage!.url, alt: lead.coverImage!.altText ?? lead.name } : null,
      content: copyOverrides(context.content, props),
    };
  },
});
