import { defineComponent } from "@wocart/theme";
import { SCHEME_OF } from "@/theme/appearance";
import { BLOCK, FIELD, GROUP, OPTION, SECTION } from "../labels";
import { schemeField, sectionSpacing, styleField } from "../shared";
import Footer from "@/theme/components/layout/Footer.astro";
import FooterAbout from "@/theme/components/footer/FooterAbout.astro";
import FooterMenu from "@/theme/components/footer/FooterMenu.astro";
import FooterPages from "@/theme/components/footer/FooterPages.astro";
import FooterText from "@/theme/components/footer/FooterText.astro";

const FOOTER_BLOCKS = ["footer-about", "footer-menu", "footer-pages", "footer-text"];

/** The networks a footer links to; each has its own icon. */
export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube"] as const;

/** The store's logo or name, a few words about it, and where else to find it. */
export const footerAbout = defineComponent({
  type: "footer-about",
  capabilities: { surfaces: ["area:footer"] },
  component: FooterAbout,
  label: BLOCK.footerAbout,
  group: GROUP.footer,
  placement: "block",
  fields: [
    { key: "text", kind: "textarea", label: FIELD.about, contentKey: "footerAbout" },
    { key: "showWhatsapp", kind: "boolean", label: FIELD.showWhatsapp, default: true },
    {
      key: "socialLinks",
      kind: "list",
      label: FIELD.socialLinks,
      max: SOCIAL_NETWORKS.length,
      itemLabel: "label",
      fields: [
        {
          key: "network",
          kind: "select",
          label: FIELD.network,
          options: SOCIAL_NETWORKS,
          optionLabels: { instagram: OPTION.instagram, facebook: OPTION.facebook, tiktok: OPTION.tiktok, youtube: OPTION.youtube },
          default: "instagram",
        },
        { key: "href", kind: "url", label: FIELD.link },
        { key: "label", kind: "text", label: FIELD.socialLabel },
      ],
    },
  ],
});

/** A column of links: one of the store's menus under a title. */
export const footerMenu = defineComponent({
  type: "footer-menu",
  capabilities: { surfaces: ["area:footer"] },
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
  capabilities: { surfaces: ["area:footer"] },
  component: FooterPages,
  label: BLOCK.footerPages,
  group: GROUP.footer,
  placement: "block",
  fields: [
    { key: "title", kind: "text", label: FIELD.title, contentKey: "footerSupport" },
    { key: "showTrackOrder", kind: "boolean", label: FIELD.showTrackOrder, default: true },
  ],
});

/** A title and a few lines the merchant writes. */
export const footerText = defineComponent({
  type: "footer-text",
  capabilities: { surfaces: ["area:footer"] },
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
  fields: [schemeField(SCHEME_OF.night), styleField(sectionSpacing(true))],
  capabilities: { surfaces: ["area:footer"] },
  presets: [
    {
      key: "default",
      label: SECTION.footer,
      slots: { columns: [{ type: "footer-about" }, { type: "footer-menu" }, { type: "footer-pages" }] },
    },
  ],
});
