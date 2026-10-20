import { defineComponent } from "@wocart/theme";
import { BLOCK, FIELD, GROUP, SECTION } from "../labels";
import { FOOTER_AREA, schemeField, sectionSpacing, styleField } from "../shared";
import Footer from "@/theme/components/layout/Footer.astro";
import FooterAbout from "@/theme/components/footer/FooterAbout.astro";
import FooterMenu from "@/theme/components/footer/FooterMenu.astro";
import FooterPages from "@/theme/components/footer/FooterPages.astro";
import FooterText from "@/theme/components/footer/FooterText.astro";

const FOOTER_BLOCKS = ["footer-about", "footer-menu", "footer-pages", "footer-text"];

/** The store's logo or name and a few words about it. */
export const footerAbout = defineComponent({
  type: "footer-about",
  component: FooterAbout,
  label: BLOCK.footerAbout,
  group: GROUP.footer,
  placement: "block",
  fields: [{ key: "text", kind: "textarea", label: FIELD.about, contentKey: "footerAbout" }],
});

/** A column of links: one of the store's menus under a title. */
export const footerMenu = defineComponent({
  type: "footer-menu",
  component: FooterMenu,
  label: BLOCK.footerMenu,
  group: GROUP.footer,
  placement: "block",
  fields: [
    { key: "title", kind: "text", label: FIELD.title, contentKey: "footerQuickLinks" },
    { key: "menu", kind: "menu", label: FIELD.menu, default: "footer" },
  ],
  load: async ({ storefront, reads, props }) => ({
    storeMenu: await reads.get(`menu:${props.menu}`, () => storefront.menus.get(props.menu)),
  }),
});

/** The store's own pages — terms, privacy, returns, delivery — under a title. */
export const footerPages = defineComponent({
  type: "footer-pages",
  component: FooterPages,
  label: BLOCK.footerPages,
  group: GROUP.footer,
  placement: "block",
  fields: [{ key: "title", kind: "text", label: FIELD.title, contentKey: "footerSupport" }],
});

/** A title and a few lines the merchant writes. */
export const footerText = defineComponent({
  type: "footer-text",
  component: FooterText,
  label: BLOCK.footerText,
  group: GROUP.footer,
  placement: "block",
  fields: [
    { key: "title", kind: "text", label: FIELD.title },
    { key: "text", kind: "richtext", label: FIELD.text, formats: ["bold", "italic", "link", "list"] },
  ],
});

/** The store's footer: columns the merchant arranges, then the store's name and the year. */
export const footer = defineComponent({
  type: "footer",
  component: Footer,
  label: SECTION.footer,
  group: GROUP.footer,
  placement: "section",
  slots: [{ name: "columns", allow: FOOTER_BLOCKS, max: 6 }],
  fields: [schemeField("scheme-4"), styleField(sectionSpacing(true))],
  capabilities: { surfaces: [FOOTER_AREA] },
  presets: [
    {
      key: "default",
      label: SECTION.footer,
      slots: { columns: [{ type: "footer-about" }, { type: "footer-menu" }, { type: "footer-pages" }] },
    },
  ],
});
