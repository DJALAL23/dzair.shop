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
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    enabled: props.enabled ?? context.store.reviewsEnabled,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});