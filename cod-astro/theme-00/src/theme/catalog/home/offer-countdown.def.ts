import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, HELP, OPTION, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, schemeField, styleField } from "../shared";
import OfferCountdown from "@/theme/components/home/OfferCountdown.astro";

/** A countdown to the end of an offer — every midnight, or a day and time the merchant sets — gone once it ends. */
export const offerCountdown = defineComponent({
  type: "offer-countdown",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing"] },
  component: OfferCountdown,
  label: SECTION.offerCountdown,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "productCountdownLabel", kind: "text", label: FIELD.title, contentKey: "productCountdownLabel" },
    {
      key: "countdown",
      kind: "select",
      label: FIELD.countdown,
      options: ["midnight", "date"],
      optionLabels: { midnight: OPTION.midnight, date: OPTION.onDate },
      default: "midnight",
      display: "segmented",
    },
    { key: "endsOn", kind: "text", label: FIELD.endsOn, description: HELP.endsOn, visibleIf: { field: "countdown", equals: "date" } },
    { key: "endsAt", kind: "text", label: FIELD.endsAt, description: HELP.endsAt, visibleIf: { field: "countdown", equals: "date" } },
    schemeField(SCHEME_OF.sand),
    styleField({ spacing: { paddingBlockStart: { base: "s6" }, paddingBlockEnd: { base: "s6" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => ({ content: copyOverrides(context.content, props) }),
  presets: [{ key: "today", label: { ar: "عرض اليوم فقط", fr: "Offre du jour", en: "Today only" }, props: { countdown: "midnight" } }],
});
