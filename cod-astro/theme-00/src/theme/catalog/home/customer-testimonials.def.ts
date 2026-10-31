import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import CustomerTestimonials from "@/theme/components/home/CustomerTestimonials.astro";
import { CATALOG_READ, copyOverrides, schemeField, styleField } from "../shared";

/** At most this many reviews show. */
const SHOWN = 6;

/** The best recent reviews of the most reviewed products, each with the product it is about. */
export const customerTestimonials = defineComponent({
  type: "customer-testimonials",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing"] },
  component: CustomerTestimonials,
  label: SECTION.customerTestimonials,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "testimonialsTitle", kind: "text", label: FIELD.title, contentKey: "testimonialsTitle" },
    { key: "testimonialsSub", kind: "text", label: FIELD.subtitle, contentKey: "testimonialsSub" },
    // No default: the section's default is `config.reviewsEnabled`, a request
    // fact — applied in `load`, overridable from page data.
    { key: "enabled", kind: "boolean", label: FIELD.showReviews },
    {
      key: "headingAlign",
      kind: "select",
      label: FIELD.headingAlign,
      options: ["start", "center"],
      optionLabels: { start: OPTION.start, center: OPTION.center },
      default: "start",
      display: "segmented",
    },
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    const enabled = props.enabled ?? context.store.reviewsEnabled;
    if (!enabled) return { items: [], content };
    // The products with the most reviews (at most 3) are worth asking the
    // reviews endpoint about; their best recent reviews become testimonials.
    const products = await reads.get(CATALOG_READ, () => storefront.products.list());
    const reviewed = products
      .filter((product) => (product.reviewStats?.reviewCount ?? 0) > 0)
      .sort((a, b) => (b.reviewStats?.reviewCount ?? 0) - (a.reviewStats?.reviewCount ?? 0))
      .slice(0, 3);
    const pages = await Promise.all(reviewed.map((product) => storefront.products.reviews.list(product.id, { limit: 2 })));
    const items = pages
      .flatMap((page, index) => page.rows.map((review) => ({ review, product: reviewed[index]! })))
      .filter(({ review }) => review.rating >= 4 && review.body.trim().length > 0)
      .slice(0, SHOWN)
      .map(({ review, product }) => ({
        review,
        product: { name: product.name, handle: product.handle, image: product.coverImage?.url ?? null },
      }));
    return { items, content };
  },
});
