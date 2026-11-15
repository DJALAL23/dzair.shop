/**
 * What a touch is: an ad or not, which channel, which platform and app.
 * One rule, mirrored by the storefront SDK (its parity check compares them).
 *
 * The channels follow Google Analytics' default channel group: paid when the
 * medium matches `^(.*cp.*|ppc|retargeting|paid.*)$`, social and search by the
 * source's site, AI assistants apart, direct when nothing is known. On top,
 * the signals table (`signals.ts`): a parameter only an ad's URL carries (a
 * TikTok, Google, Microsoft or Snapchat click id, Google's `gad_*`, Wocart's
 * ad template names) makes a touch paid; Meta's `fbclid` alone never does,
 * because Meta adds it to every link leaving Facebook and Instagram.
 */
import { AD_PARAMS, TOUCH_PARAMS, signalOf, type AttributionPlatform, type OrderChannel, type Touch } from "./model";

/** Meta's `{{site_source_name}}`: Facebook, Instagram, Messenger, Audience Network, Threads; `wa` is WhatsApp. */
export const META_APPS = ["fb", "ig", "msg", "an", "th", "wa"] as const;
export type MetaApp = (typeof META_APPS)[number];

const PAID_MEDIUM = /^(.*cp.*|ppc|retargeting|paid.*)$/i;
const SOCIAL_MEDIUMS = new Set(["social", "social-network", "social-media", "sm", "social network", "social media"]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "e_mail", "e mail"]);
const REFERRAL_MEDIUMS = new Set(["referral", "app", "link"]);

interface Site {
  readonly platform: AttributionPlatform;
  readonly kind: "social" | "search" | "email" | "ai";
  readonly app?: MetaApp;
  /** An Android app's name as people know it, for an `android-app://` referrer. */
  readonly appName?: string;
}

const META = (app: MetaApp): Site => ({ platform: "meta", kind: "social", app });
const SOCIAL: Site = { platform: "other", kind: "social" };
const SEARCH: Site = { platform: "other", kind: "search" };
const EMAIL: Site = { platform: "other", kind: "email" };
const AI: Site = { platform: "other", kind: "ai" };
const SNAPCHAT: Site = { platform: "snapchat", kind: "social" };
const GOOGLE_SEARCH: Site = { platform: "google", kind: "search" };

/**
 * Sites by registered domain: a host is the domain or one of its subdomains
 * (`l.facebook.com` is Facebook). The first match wins, so a webmail or a
 * Google site that is not its search comes before the rest of its domain.
 * After Google Analytics' source categories and Snowplow's referer list; the
 * AI assistants are Google Analytics' "AI Assistant" channel, by the hosts
 * Plausible names.
 */
const SITES: ReadonlyArray<readonly [string, Site]> = [
  ["chatgpt.com", AI],
  ["chat.openai.com", AI],
  ["gemini.google.com", AI],
  ["bard.google.com", AI],
  ["copilot.microsoft.com", AI],
  ["perplexity.ai", AI],
  ["claude.ai", AI],
  ["chat.deepseek.com", AI],
  ["deepseek.com", AI],
  ["grok.com", AI],
  ["mail.google.com", EMAIL],
  ["mail.yahoo.com", EMAIL],
  ["outlook.live.com", EMAIL],
  ["outlook.office.com", EMAIL],
  ["outlook.office365.com", EMAIL],
  ["groups.google.com", SOCIAL],
  ["sites.google.com", SOCIAL],
  ["messages.google.com", SOCIAL],
  ["facebook.com", META("fb")],
  ["fb.com", META("fb")],
  ["fb.me", META("fb")],
  ["instagram.com", META("ig")],
  ["messenger.com", META("msg")],
  ["m.me", META("msg")],
  ["threads.net", META("th")],
  ["threads.com", META("th")],
  ["whatsapp.com", META("wa")],
  ["wa.me", META("wa")],
  ["tiktok.com", { platform: "tiktok", kind: "social" }],
  ["youtube.com", SOCIAL],
  ["youtu.be", SOCIAL],
  ["x.com", SOCIAL],
  ["twitter.com", SOCIAL],
  ["t.co", SOCIAL],
  ["linkedin.com", SOCIAL],
  ["lnkd.in", SOCIAL],
  ["snapchat.com", SNAPCHAT],
  ["pinterest.com", SOCIAL],
  ["reddit.com", SOCIAL],
  ["t.me", SOCIAL],
  ["telegram.org", SOCIAL],
  ["bing.com", { platform: "bing", kind: "search" }],
  ["search.yahoo.com", SEARCH],
  ["duckduckgo.com", SEARCH],
  ["ecosia.org", SEARCH],
  ["qwant.com", SEARCH],
  ["baidu.com", SEARCH],
  ["naver.com", SEARCH],
  ["seznam.cz", SEARCH],
  ["sogou.com", SEARCH],
  ["so.com", SEARCH],
  ["search.brave.com", SEARCH],
  ["kagi.com", SEARCH],
  ["startpage.com", SEARCH],
  ["petalsearch.com", SEARCH],
  ["ask.com", SEARCH],
  ["search.aol.com", SEARCH],
];

/** Sites by exact host only: their domain's other hosts are something else (`mail.yahoo.com` is a webmail). */
const HOSTS: Readonly<Record<string, Site>> = {
  "yahoo.com": SEARCH,
  "www.yahoo.com": SEARCH,
  "ya.ru": SEARCH,
};

/** Android apps by package, as an `android-app://` referrer names them (Snowplow's list, and the stores' own ids). */
const ANDROID_APPS: Readonly<Record<string, Site>> = {
  "com.google.android.googlequicksearchbox": { ...GOOGLE_SEARCH, appName: "Google" },
  "com.google.android.gm": { ...EMAIL, appName: "Gmail" },
  "com.microsoft.office.outlook": { ...EMAIL, appName: "Outlook" },
  "com.yahoo.mobile.client.android.mail": { ...EMAIL, appName: "Yahoo Mail" },
  "com.facebook.katana": { ...META("fb"), appName: "Facebook" },
  "com.facebook.lite": { ...META("fb"), appName: "Facebook Lite" },
  "com.facebook.orca": { ...META("msg"), appName: "Messenger" },
  "com.facebook.mlite": { ...META("msg"), appName: "Messenger Lite" },
  "com.instagram.android": { ...META("ig"), appName: "Instagram" },
  "com.instagram.lite": { ...META("ig"), appName: "Instagram Lite" },
  "com.instagram.barcelona": { ...META("th"), appName: "Threads" },
  "com.whatsapp": { ...META("wa"), appName: "WhatsApp" },
  "com.whatsapp.w4b": { ...META("wa"), appName: "WhatsApp Business" },
  "com.zhiliaoapp.musically": { platform: "tiktok", kind: "social", appName: "TikTok" },
  "com.ss.android.ugc.trill": { platform: "tiktok", kind: "social", appName: "TikTok" },
  "com.zhiliaoapp.musically.go": { platform: "tiktok", kind: "social", appName: "TikTok Lite" },
  "com.google.android.youtube": { ...SOCIAL, appName: "YouTube" },
  "org.telegram.messenger": { ...SOCIAL, appName: "Telegram" },
  "org.telegram.messenger.web": { ...SOCIAL, appName: "Telegram" },
  "com.twitter.android": { ...SOCIAL, appName: "X" },
  "com.linkedin.android": { ...SOCIAL, appName: "LinkedIn" },
  "com.snapchat.android": { ...SNAPCHAT, appName: "Snapchat" },
  "com.openai.chatgpt": { ...AI, appName: "ChatGPT" },
  "com.google.android.apps.bard": { ...AI, appName: "Gemini" },
  "ai.perplexity.app.android": { ...AI, appName: "Perplexity" },
  "com.microsoft.copilot": { ...AI, appName: "Copilot" },
  "com.anthropic.claude": { ...AI, appName: "Claude" },
  "com.pinterest": { ...SOCIAL, appName: "Pinterest" },
  "com.reddit.frontpage": { ...SOCIAL, appName: "Reddit" },
};

const SOURCES: Readonly<Record<string, Site>> = {
  facebook: META("fb"),
  fb: META("fb"),
  meta: { platform: "meta", kind: "social" },
  instagram: META("ig"),
  ig: META("ig"),
  messenger: META("msg"),
  msg: META("msg"),
  an: META("an"),
  threads: META("th"),
  th: META("th"),
  whatsapp: META("wa"),
  wa: META("wa"),
  tiktok: { platform: "tiktok", kind: "social" },
  youtube: SOCIAL,
  snapchat: SNAPCHAT,
  snap: SNAPCHAT,
  chatgpt: AI,
  openai: AI,
  gemini: AI,
  copilot: AI,
  perplexity: AI,
  claude: AI,
  deepseek: AI,
  grok: AI,
  twitter: SOCIAL,
  x: SOCIAL,
  linkedin: SOCIAL,
  pinterest: SOCIAL,
  telegram: SOCIAL,
  google: GOOGLE_SEARCH,
  bing: { platform: "bing", kind: "search" },
};

/** Google's search, by any of its country domains (`google.fr`, `google.com.dz`): the hosts Google Analytics counts as search. */
const GOOGLE_SEARCH_HOST = /^(?:(?:www|search|news|lens|play|images|encrypted)\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/;
const YANDEX_MAIL_HOST = /^mail\.yandex\.[a-z]{2,3}$/;
const YANDEX_HOST = /(^|\.)yandex\.[a-z]{2,3}$/;

/** The site a host belongs to: a website by its domain (`l.facebook.com` is Facebook), or an Android app by its package. Null for any other site. */
export function siteOfHost(host: string | null | undefined): Site | null {
  if (!host) return null;
  const name = host.toLowerCase();
  const app = ANDROID_APPS[name];
  if (app) return app;
  const exact = HOSTS[name];
  if (exact) return exact;
  for (const [domain, site] of SITES) {
    if (name === domain || name.endsWith(`.${domain}`)) return site;
  }
  if (GOOGLE_SEARCH_HOST.test(name)) return GOOGLE_SEARCH;
  if (YANDEX_MAIL_HOST.test(name)) return EMAIL;
  if (YANDEX_HOST.test(name)) return SEARCH;
  return null;
}

/** The name of the Android app a referrer names, or null for a website or an app not listed. */
export function androidAppName(host: string | null | undefined): string | null {
  return (host && ANDROID_APPS[host.toLowerCase()]?.appName) || null;
}

function metaApp(value: string | undefined): MetaApp | null {
  const app = value?.toLowerCase();
  return app && (META_APPS as readonly string[]).includes(app) ? (app as MetaApp) : null;
}

/** Whether a touch is an ad click. */
export function isPaidTouch(touch: Pick<Touch, "params">): boolean {
  const { params } = touch;
  if (AD_PARAMS.some((param) => params[param])) return true;
  return Boolean(params.utm_medium && PAID_MEDIUM.test(params.utm_medium.trim()));
}

/** What a touch is, as an order shows it. */
export interface TouchClass {
  readonly channel: OrderChannel;
  readonly platform: AttributionPlatform;
  /** The Meta app (Facebook, Instagram…) when it is known. */
  readonly app: MetaApp | null;
}

/** The site a `utm_source` names: a known name (`facebook`, `chatgpt`), or a host (`chatgpt.com`, `l.instagram.com`). */
function sourceSite(source: string | undefined): Site | null {
  const name = source?.trim().toLowerCase();
  if (!name) return null;
  return SOURCES[name] ?? (name.includes(".") ? siteOfHost(name) : null);
}

/**
 * The platform the touch's URL signals name, and the channel family of its
 * click: an ad's signal first (in the table's order), else any other that
 * names a platform (`fbclid`, `srsltid`). Google's `gad_source=1` is a search
 * ad, as PostHog reads it; another value leaves the family to the source.
 */
interface Signalled {
  readonly platform: AttributionPlatform;
  readonly kind: Site["kind"] | null;
  readonly ad: boolean;
}

function signalled(params: Touch["params"]): Signalled | null {
  let other: Signalled | null = null;
  for (const param of TOUCH_PARAMS) {
    const { platform, means, kind } = signalOf(param);
    if (!params[param] || !platform) continue;
    const found = { platform, kind: kind ?? (param === "gad_source" && params.gad_source === "1" ? "search" : null), ad: means === "ad" };
    if (found.ad) return found;
    other ??= found;
  }
  return other;
}

/**
 * The channel, platform and app of a touch, or of no touch at all (direct).
 * With `{ ad: false }`, a touch that was an ad is read as what it is without
 * the ad: an ad clicked too long ago to be credited is no paid source.
 */
export function classifyTouch(touch: Pick<Touch, "params" | "ref"> | null, options: { ad?: boolean } = {}): TouchClass {
  if (!touch) return { channel: "direct", platform: "direct", app: null };
  const { params } = touch;
  const medium = params.utm_medium?.trim().toLowerCase();
  const bySource = sourceSite(params.utm_source);
  const byHost = siteOfHost(touch.ref);
  const templateApp = metaApp(params.wc_ss);
  const signal = signalled(params);
  const clicked = signal?.ad ? signal : templateApp ? { platform: "meta" as const, kind: "social" as const } : signal;
  const platform: AttributionPlatform =
    clicked?.platform ?? bySource?.platform ?? byHost?.platform ?? (touch.ref ? "referral" : Object.keys(params).length > 0 ? "other" : "direct");
  const app = platform === "meta" ? (templateApp ?? bySource?.app ?? byHost?.app ?? null) : null;
  const kind = clicked ? clicked.kind : (bySource?.kind ?? byHost?.kind ?? null);

  if (options.ad !== false && isPaidTouch(touch)) {
    return { channel: kind === "social" ? "paid_social" : kind === "search" ? "paid_search" : "paid_other", platform, app };
  }
  if (kind === "email" || (medium && EMAIL_MEDIUMS.has(medium))) return { channel: "email", platform, app };
  if (kind === "ai") return { channel: "ai_assistant", platform, app };
  if (kind === "social" || (medium && SOCIAL_MEDIUMS.has(medium))) return { channel: "organic_social", platform, app };
  if (kind === "search" || medium === "organic") return { channel: "organic_search", platform, app };
  if (touch.ref || (medium && REFERRAL_MEDIUMS.has(medium))) return { channel: "referral", platform, app };
  if (Object.keys(params).length > 0) return { channel: "tagged", platform, app };
  return { channel: "direct", platform: "direct", app: null };
}
