import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import { schemeField } from "../shared";
import Header from "@/theme/components/layout/Header.astro";

/**
 * The store's header: its logo, the menu the merchant picks, search, the
 * language picker and the cart. Every header area holds exactly one.
 */
export const header = defineComponent({
  type: "header",
  capabilities: { surfaces: ["area:header"] },
  component: Header,
  label: SECTION.header,
  group: GROUP.header,
  placement: "section",
  fields: [
    { key: "menu", kind: "menu", label: FIELD.menu, default: "main-menu" },
    {
      key: "logoPosition",
      kind: "select",
      label: FIELD.logoPosition,
      options: ["start", "center"],
      optionLabels: { start: OPTION.start, center: OPTION.center },
      default: "start",
      display: "segmented",
    },
    { key: "logoWidth", kind: "number", label: FIELD.logoWidth, min: 80, max: 240, step: 10, default: 140, display: "slider" },
    { key: "sticky", kind: "boolean", label: FIELD.sticky, default: true },
    { key: "showSearch", kind: "boolean", label: FIELD.showSearch, default: true },
    { key: "showLanguage", kind: "boolean", label: FIELD.showLanguage, default: true },
    schemeField("scheme-1"),
  ],
  load: async ({ storefront, reads, props }) => ({
    storeMenu: await reads.get(`menu:${props.menu}`, () => storefront.menus.get(props.menu)),
  }),
});
