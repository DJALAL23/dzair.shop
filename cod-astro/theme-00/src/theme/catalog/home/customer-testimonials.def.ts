import { defineComponent } from "@codflow/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import CustomerTestimonials from "@/theme/components/home/CustomerTestimonials.astro";
import { CATALOG_READ, copyOverrides } from "../shared";

export const customerTestimonials = defineComponent({
  type: "customer-testimonials",
  component: CustomerTestimonials,
  label: SECTION.customerTestimonials,
  group: GROUP.home,
  fields: [
    { key: "testimonialsTitle", kind: "text", label: FIELD.title, contentKey: "testimonialsTitle" },
    { key: "testimonialsSub", kind: "text", label: FIELD.subtitle, contentKey: "testimonialsSub" },
    // No default: the section's default is `config.reviewsEnabled`, a request
    // fact — applied in `load`, overridable from page data.
    { key: "enabled", kind: "boolean", label: FIELD.showReviews },
  ],
  load: async ({ storefront, reads, context, props }) => {
    const enabled = props.enabled ?? context.store.reviewsEnabled;
    if (!enabled) return { reviews: [], content: copyOverrides(context.content, props) };
    // The products with the most reviews (at most 3) are worth asking the
    // reviews endpoint about; their best recent reviews become testimonials.
    const products = await reads.get(CATALOG_READ, () => storefront.products.list());
    const reviewed = products
      .filter((product) => (product.reviewStats?.reviewCount ?? 0) > 0)
      .sort((a, b) => (b.reviewStats?.reviewCount ?? 0) - (a.reviewStats?.reviewCount ?? 0))
      .slice(0, 3);
    const pages = await Promise.all(reviewed.map((product) => storefront.products.reviews.list(product.id, { limit: 2 })));
    return {
      reviews: pages.flatMap((page) => page.rows).filter((review) => review.rating >= 4).slice(0, 3),
      content: copyOverrides(context.content, props),
    };
  },
  capabilities: { insertable: true },
});