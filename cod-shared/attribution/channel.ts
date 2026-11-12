/**
 * What a touch is: an ad or not, which channel, which platform and app.
 * One rule, mirrored by the storefront SDK (its parity check compares them).
 *
 * The channels follow Google Analytics' default channel group: paid when the
 * medium matches `^(.*cp.*|ppc|retargeting|paid.*)$`, social and search by the
 * source's site, direct when nothing is known. Two Wocart rules on top:
 * a click id only ad clicks carry (`ttclid`, `gclid`, `gbraid`, `wbraid`) or
 * Wocart's ad template names (`wc_cn`, `wc_an`) make a touch paid; Meta's
 * `fbclid` alone never does, because Meta adds it to every link leaving
 * Facebook and Instagram.
 */
import { AD_ONLY_CLICK_IDS, type AttributionPlatform, type OrderChannel, type Touch } from "./model";

/** Meta's `{{site_source_name}}`: Facebook, Instagram, Messenger, Audience Network, Threads; `wa` is WhatsApp. */
export const META_APPS = ["fb", "ig", "msg", "an", "th", "wa"] as const;
export type MetaApp = (typeof META_APPS)[number];

const PAID_MEDIUM = /^(.*cp.*|ppc|retargeting|paid.*)$/i;
const SOCIAL_MEDIUMS = new Set(["social", "social-network", "social-media", "sm", "social network", "social media"]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "e_mail", "e mail"]);
const REFERRAL_MEDIUMS = new Set(["referral", "app", "link"]);

interface Site {
  readonly platform: AttributionPlatform;
  readonly kind: "social" | "search";
  readonly app?: MetaApp;
}

const SITES: ReadonlyArray<readonly [string, Site]> = [
  ["facebook.com", { platform: "meta", kind: "social", app: "fb" }],
  ["fb.com", { platform: "meta", kind: "social", app: "fb" }],
  ["fb.me", { platform: "meta", kind: "social", app: "fb" }],
  ["instagram.com", { platform: "meta", kind: "social", app: "ig" }],
  ["messenger.com", { platform: "meta", kind: "social", app: "msg" }],
  ["m.me", { platform: "meta", kind: "social", app: "msg" }],
  ["threads.net", { platform: "meta", kind: "social", app: "th" }],
  ["threads.com", { platform: "meta", kind: "social", app: "th" }],
  ["whatsapp.com", { platform: "meta", kind: "social", app: "wa" }],
  ["wa.me", { platform: "meta", kind: "social", app: "wa" }],
  ["tiktok.com", { platform: "tiktok", kind: "social" }],
  ["youtube.com", { platform: "other", kind: "social" }],
  ["youtu.be", { platform: "other", kind: "social" }],
  ["x.com", { platform: "other", kind: "social" }],
  ["twitter.com", { platform: "other", kind: "social" }],
  ["t.co", { platform: "other", kind: "social" }],
  ["linkedin.com", { platform: "other", kind: "social" }],
  ["lnkd.in", { platform: "other", kind: "social" }],
  ["snapchat.com", { platform: "other", kind: "social" }],
  ["pinterest.com", { platform: "other", kind: "social" }],
  ["reddit.com", { platform: "other", kind: "social" }],
  ["t.me", { platform: "other", kind: "social" }],
  ["telegram.org", { platform: "other", kind: "social" }],
  ["bing.com", { platform: "bing", kind: "search" }],
  ["yahoo.com", { platform: "other", kind: "search" }],
  ["duckduckgo.com", { platform: "other", kind: "search" }],
  ["ecosia.org", { platform: "other", kind: "search" }],
  ["qwant.com", { platform: "other", kind: "search" }],
  ["baidu.com", { platform: "other", kind: "search" }],
];

const SOURCES: Readonly<Record<string, Site>> = {
  facebook: { platform: "meta", kind: "social", app: "fb" },
  fb: { platform: "meta", kind: "social", app: "fb" },
  meta: { platform: "meta", kind: "social" },
  instagram: { platform: "meta", kind: "social", app: "ig" },
  ig: { platform: "meta", kind: "social", app: "ig" },
  messenger: { platform: "meta", kind: "social", app: "msg" },
  threads: { platform: "meta", kind: "social", app: "th" },
  whatsapp: { platform: "meta", kind: "social", app: "wa" },
  tiktok: { platform: "tiktok", kind: "social" },
  youtube: { platform: "other", kind: "social" },
  snapchat: { platform: "other", kind: "social" },
  twitter: { platform: "other", kind: "social" },
  x: { platform: "other", kind: "social" },
  linkedin: { platform: "other", kind: "social" },
  pinterest: { platform: "other", kind: "social" },
  telegram: { platform: "other", kind: "social" },
  google: { platform: "google", kind: "search" },
  bing: { platform: "bing", kind: "search" },
};

/** The site a host belongs to, by its registered domain (`l.facebook.com` is Facebook, `google.fr` is Google). */
export function siteOfHost(host: string | null | undefined): Site | null {
  if (!host) return null;
  const name = host.toLowerCase();
  for (const [domain, site] of SITES) {
    if (name === domain || name.endsWith(`.${domain}`)) return site;
  }
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(name)) return { platform: "google", kind: "search" };
  if (/(^|\.)yandex\.[a-z]{2,3}$/.test(name)) return { platform: "other", kind: "search" };
  return null;
}

function metaApp(value: string | undefined): MetaApp | null {
  const app = value?.toLowerCase();
  return app && (META_APPS as readonly string[]).includes(app) ? (app as MetaApp) : null;
}

/** Whether a touch is an ad click. */
export function isPaidTouch(touch: Pick<Touch, "params">): boolean {
  const { params } = touch;
  if (AD_ONLY_CLICK_IDS.some((id) => params[id])) return true;
  if (params.utm_medium && PAID_MEDIUM.test(params.utm_medium.trim())) return true;
  return Boolean(params.wc_cn || params.wc_an);
}

/** What a touch is, as an order shows it. */
export interface TouchClass {
  readonly channel: OrderChannel;
  readonly platform: AttributionPlatform;
  /** The Meta app (Facebook, Instagram…) when it is known. */
  readonly app: MetaApp | null;
}

/** The channel, platform and app of a touch, or of no touch at all (direct). */
export function classifyTouch(touch: Pick<Touch, "params" | "ref"> | null): TouchClass {
  if (!touch) return { channel: "direct", platform: "direct", app: null };
  const { params } = touch;
  const medium = params.utm_medium?.trim().toLowerCase();
  const bySource = params.utm_source ? (SOURCES[params.utm_source.trim().toLowerCase()] ?? null) : null;
  const byHost = siteOfHost(touch.ref);
  const templateApp = metaApp(params.wc_ss);
  const clickPlatform: AttributionPlatform | null = params.ttclid
    ? "tiktok"
    : params.gclid || params.gbraid || params.wbraid
      ? "google"
      : params.fbclid || templateApp
        ? "meta"
        : null;
  const platform: AttributionPlatform =
    clickPlatform ?? bySource?.platform ?? byHost?.platform ?? (touch.ref ? "referral" : Object.keys(params).length > 0 ? "other" : "direct");
  const app = platform === "meta" ? (templateApp ?? bySource?.app ?? byHost?.app ?? null) : null;
  const kind = clickPlatform === "google" ? "search" : clickPlatform ? "social" : (bySource?.kind ?? byHost?.kind ?? null);

  if (isPaidTouch(touch)) {
    return { channel: kind === "social" ? "paid_social" : kind === "search" ? "paid_search" : "paid_other", platform, app };
  }
  if (medium && EMAIL_MEDIUMS.has(medium)) return { channel: "email", platform, app };
  if (kind === "social" || (medium && SOCIAL_MEDIUMS.has(medium))) return { channel: "organic_social", platform, app };
  if (kind === "search" || medium === "organic") return { channel: "organic_search", platform, app };
  if (touch.ref || (medium && REFERRAL_MEDIUMS.has(medium))) return { channel: "referral", platform, app };
  if (Object.keys(params).length > 0) return { channel: "tagged", platform, app };
  return { channel: "direct", platform: "direct", app: null };
}
