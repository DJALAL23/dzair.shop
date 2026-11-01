import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import { copyOverrides, schemeField, styleField } from "../shared";
import TrackOrderMain from "@/theme/components/track-order/TrackOrderMain.astro";

/**
 * Following an order: its number and the phone it was placed with, then
 * where it is — its step on the way, its lines and its total — and a way to
 * ask the store about it. The title and the introduction are the merchant's.
 */
export const trackOrderMain = defineComponent({
  type: "track-order-main",
  capabilities: { surfaces: ["track-order"] },
  component: TrackOrderMain,
  label: SECTION.trackOrderMain,
  group: GROUP.store,
  placement: "section",
  fields: [
    { key: "trackTitle", kind: "text", label: FIELD.title, contentKey: "trackTitle" },
    { key: "trackIntro", kind: "textarea", label: FIELD.intro, contentKey: "trackIntro" },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s7", lg: "s9" }, paddingBlockEnd: { base: "s8", lg: "s10" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async ({ context, props }) => ({ content: copyOverrides(context.content, props) }),
});
