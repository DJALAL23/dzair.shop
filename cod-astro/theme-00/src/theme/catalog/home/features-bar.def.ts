import { defineComponent, type FieldDefinition } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import FeaturesBar from "@/theme/components/home/FeaturesBar.astro";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, schemeField, styleField } from "../shared";

/** The icons a feature may wear, by the name a merchant picks. */
export const FEATURE_ICONS = {
  cash: "heroicons:banknotes",
  truck: "heroicons:truck",
  phone: "heroicons:phone",
  shield: "heroicons:shield-check",
  return: "heroicons:arrow-path",
  star: "heroicons:star",
  gift: "heroicons:gift",
  clock: "heroicons:clock",
  chat: "heroicons:chat-bubble-left-right",
  badge: "heroicons:check-badge",
} as const;

const iconField = <K extends string>(n: number, key: K, fallback: keyof typeof FEATURE_ICONS) =>
  ({
    key,
    kind: "select",
    label: FIELD.icon(n),
    options: Object.keys(FEATURE_ICONS) as Array<keyof typeof FEATURE_ICONS>,
    optionLabels: {
      cash: OPTION.iconCash,
      truck: OPTION.iconTruck,
      phone: OPTION.iconPhone,
      shield: OPTION.iconShield,
      return: OPTION.iconReturn,
      star: OPTION.iconStar,
      gift: OPTION.iconGift,
      clock: OPTION.iconClock,
      chat: OPTION.iconChat,
      badge: OPTION.iconBadge,
    },
    default: fallback,
  }) as const satisfies FieldDefinition;

/** Four short promises, each an icon, a title and a line under it. */
export const featuresBar = defineComponent({
  type: "features-bar",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "thank-you", "collection", "category", "catalog", "search", "track-order", "checkout", "contact", "area:footer"] },
  component: FeaturesBar,
  label: SECTION.featuresBar,
  group: GROUP.home,
  placement: "section",
  fields: [
    iconField(1, "feature1Icon", "cash"),
    { key: "feature1Title", kind: "text", label: FIELD.feature(1), contentKey: "feature1Title" },
    { key: "feature1Sub", kind: "text", label: FIELD.featureText(1), contentKey: "feature1Sub" },
    iconField(2, "feature2Icon", "truck"),
    { key: "feature2Title", kind: "text", label: FIELD.feature(2), contentKey: "feature2Title" },
    { key: "feature2Sub", kind: "text", label: FIELD.featureText(2), contentKey: "feature2Sub" },
    iconField(3, "feature3Icon", "phone"),
    { key: "feature3Title", kind: "text", label: FIELD.feature(3), contentKey: "feature3Title" },
    { key: "feature3Sub", kind: "text", label: FIELD.featureText(3), contentKey: "feature3Sub" },
    iconField(4, "feature5Icon", "badge"),
    { key: "feature5Title", kind: "text", label: FIELD.feature(4), contentKey: "feature5Title" },
    { key: "feature5Sub", kind: "text", label: FIELD.featureText(4), contentKey: "feature5Sub" },
    schemeField(SCHEME_OF.stone),
    styleField({ spacing: { paddingBlockStart: { base: "s7", lg: "s9" }, paddingBlockEnd: { base: "s7", lg: "s9" } }, size: { width: { base: "wide" } } }),
  ],
  load: async ({ context, props }) => ({
    content: copyOverrides(context.content, props),
  }),
});
