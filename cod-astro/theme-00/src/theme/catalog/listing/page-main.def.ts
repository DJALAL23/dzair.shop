import { defineComponent } from "@wocart/theme";
import type { StorePagePublic } from "@wocart/storefront";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { schemeField, styleField } from "../shared";
import PageMain from "@/theme/components/listing/PageMain.astro";

/** The read key of a text page by its slug; its route primes it. */
export const pageBySlug = (slug: string) => `page:${slug}`;

/** A text page of the store — its terms, its delivery policy, a page of its own — under its title. */
export const pageMain = defineComponent({
  type: "page-main",
  capabilities: { surfaces: ["page"] },
  component: PageMain,
  label: SECTION.pageMain,
  group: GROUP.page,
  placement: "section",
  fields: [
    {
      key: "headerAlign",
      kind: "select",
      label: FIELD.headerAlign,
      options: ["center", "start"],
      optionLabels: { center: OPTION.center, start: OPTION.start },
      default: "center",
      display: "segmented",
    },
    { key: "showBreadcrumbs", kind: "boolean", label: FIELD.showBreadcrumbs, default: true },
    { key: "headScheme", kind: "colorScheme", label: FIELD.headScheme, default: SCHEME_OF.stone },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s7", lg: "s9" }, paddingBlockEnd: { base: "s8", lg: "s10" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ storefront, reads, context }): Promise<{ page: StorePagePublic | null }> => {
    const slug = context.params?.slug ?? "";
    return { page: slug === "" ? null : await reads.get(pageBySlug(slug), () => storefront.pages.get(slug)) };
  },
});
