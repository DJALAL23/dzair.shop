import { defineComponent } from "@wocart/theme";
import { SCHEME_OF } from "@/theme/appearance";
import { BLOCK, FIELD, GROUP, SECTION } from "../labels";
import { schemeField } from "../shared";
import AnnouncementBar from "@/theme/components/header/AnnouncementBar.astro";
import Announcement from "@/theme/components/header/Announcement.astro";

/** One line of the bar: a message, and where it leads when it leads somewhere. */
export const announcement = defineComponent({
  type: "announcement",
  capabilities: { surfaces: ["area:header"] },
  component: Announcement,
  label: BLOCK.announcement,
  group: GROUP.header,
  placement: "block",
  fields: [
    { key: "text", kind: "text", label: FIELD.text, contentKey: "announcementText" },
    { key: "link", kind: "url", label: FIELD.link },
  ],
});

/** The band over the header: one message at a time, turning when there are several. */
export const announcementBar = defineComponent({
  type: "announcement-bar",
  component: AnnouncementBar,
  label: SECTION.announcementBar,
  group: GROUP.header,
  placement: "section",
  slots: [{ name: "default", allow: ["announcement"], max: 5 }],
  fields: [
    schemeField(SCHEME_OF.night),
    { key: "autoplay", kind: "boolean", label: FIELD.autoplay, default: true },
  ],
  capabilities: { surfaces: ["area:header"] },
  presets: [{ key: "default", label: SECTION.announcementBar, slots: { default: [{ type: "announcement" }] } }],
});
