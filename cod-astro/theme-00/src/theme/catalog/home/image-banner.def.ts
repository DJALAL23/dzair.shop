import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import ImageBanner from "@/theme/components/home/ImageBanner.astro";
import { copyOverrides } from "../shared";

export const imageBanner = defineComponent({
  type: "image-banner",
  component: ImageBanner,
  label: SECTION.imageBanner,
  group: GROUP.home,
  fields: [
    { key: "image", kind: "image", label: FIELD.image },
    {
      key: "imageSide",
      kind: "select",
      label: FIELD.imageSide,
      options: ["start", "end"],
      optionLabels: { start: OPTION.start, end: OPTION.end },
      default: "start",
    },
    { key: "bannerTitle", kind: "text", label: FIELD.title, contentKey: "bannerTitle" },
    { key: "body", kind: "richtext", label: FIELD.text, formats: ["bold", "italic", "link"] },
    { key: "bannerCta", kind: "text", label: FIELD.button, contentKey: "bannerCta" },
    { key: "ctaHref", kind: "url", label: FIELD.buttonLink, default: "/products" },
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});
