import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { androidAppName, classifyTouch, isPaidTouch, siteOfHost } from "./channel";
import { ORDER_CHANNELS, TOUCH_PARAMS } from "./model";

const t = (params: Record<string, string>, ref: string | null = null) => ({ params, ref });

/** Wocart's ad URL template, as Meta fills it on a click (report 02 §5.1). */
const META_TEMPLATE = {
  utm_source: "facebook",
  utm_medium: "paid_social",
  utm_campaign: "120200000000000001",
  utm_term: "120200000000000002",
  utm_content: "120200000000000003",
  wc_cn: "Robe été",
  wc_an: "Vidéo 1",
  wc_pl: "Instagram_Stories",
  wc_ss: "ig",
  fbclid: "IwAR2F4",
};

describe("isPaidTouch", () => {
  it("is an ad click when the medium matches Google Analytics' paid rule", () => {
    for (const medium of ["cpc", "CPC", "ppc", "cpm", "retargeting", "paid", "paid_social", "paid-social", "Paid Search", " cpc "]) {
      expect(isPaidTouch(t({ utm_medium: medium })), medium).toBe(true);
    }
    for (const medium of ["social", "organic", "email", "referral", "unpaid", "pai", "retarget", "p"]) {
      expect(isPaidTouch(t({ utm_medium: medium })), medium).toBe(false);
    }
  });

  it("is an ad click with a click id only ads carry: TikTok's, or Google's on any device", () => {
    for (const id of ["ttclid", "gclid", "gbraid", "wbraid"]) expect(isPaidTouch(t({ [id]: "x1" })), id).toBe(true);
  });

  it("is an ad click with Wocart's ad template names", () => {
    expect(isPaidTouch(t({ wc_cn: "Robe" }))).toBe(true);
    expect(isPaidTouch(t({ wc_an: "Vidéo 1" }))).toBe(true);
  });

  it("is not an ad click for a bare fbclid: Meta adds it to every link leaving Facebook and Instagram", () => {
    expect(isPaidTouch(t({ fbclid: "IwAR2F4" }, "l.facebook.com"))).toBe(false);
    expect(isPaidTouch(t({ fbclid: "IwAR2F4", utm_source: "facebook" }))).toBe(false);
    expect(isPaidTouch(t({ wc_ss: "fb", wc_pl: "Facebook_Mobile_Feed" }))).toBe(false);
    expect(isPaidTouch(t({}, "google.com"))).toBe(false);
  });
});

describe("classifyTouch", () => {
  it("reads Meta's template click as a paid social Meta ad, in the app Meta named", () => {
    expect(classifyTouch(t(META_TEMPLATE, "l.instagram.com"))).toEqual({ channel: "paid_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({ ...META_TEMPLATE, wc_ss: "fb" }))).toEqual({ channel: "paid_social", platform: "meta", app: "fb" });
  });

  it("reads TikTok's and Google's ad clicks", () => {
    expect(classifyTouch(t({ ttclid: "E.C.P.x" }))).toEqual({ channel: "paid_social", platform: "tiktok", app: null });
    for (const id of ["gclid", "gbraid", "wbraid"]) expect(classifyTouch(t({ [id]: "x" })), id).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ utm_source: "bing", utm_medium: "cpc" }))).toEqual({ channel: "paid_search", platform: "bing", app: null });
  });

  it("reads a paid link from an unknown network as paid other", () => {
    expect(classifyTouch(t({ utm_source: "ouedkniss", utm_medium: "cpc" }))).toEqual({ channel: "paid_other", platform: "other", app: null });
  });

  it("reads a Facebook or Instagram link that is not an ad as organic social", () => {
    expect(classifyTouch(t({ fbclid: "IwAR2F4" }))).toEqual({ channel: "organic_social", platform: "meta", app: null });
    expect(classifyTouch(t({ fbclid: "IwAR2F4" }, "l.facebook.com"))).toEqual({ channel: "organic_social", platform: "meta", app: "fb" });
    expect(classifyTouch(t({}, "l.instagram.com"))).toEqual({ channel: "organic_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({}, "wa.me"))).toEqual({ channel: "organic_social", platform: "meta", app: "wa" });
    expect(classifyTouch(t({}, "www.tiktok.com"))).toEqual({ channel: "organic_social", platform: "tiktok", app: null });
    expect(classifyTouch(t({ utm_source: "newsletter", utm_medium: "social" }))).toMatchObject({ channel: "organic_social" });
  });

  it("reads search engines, in every country, as organic search", () => {
    for (const host of ["www.google.com", "google.dz", "www.google.co.uk", "google.fr"]) {
      expect(classifyTouch(t({}, host)), host).toEqual({ channel: "organic_search", platform: "google", app: null });
    }
    expect(classifyTouch(t({}, "www.bing.com"))).toEqual({ channel: "organic_search", platform: "bing", app: null });
    expect(classifyTouch(t({}, "duckduckgo.com"))).toMatchObject({ channel: "organic_search" });
    expect(classifyTouch(t({ utm_medium: "organic" }))).toMatchObject({ channel: "organic_search" });
  });

  it("reads email, other sites and tagged links", () => {
    expect(classifyTouch(t({ utm_source: "brevo", utm_medium: "email" }))).toMatchObject({ channel: "email" });
    expect(classifyTouch(t({}, "blog.example.dz"))).toEqual({ channel: "referral", platform: "referral", app: null });
    expect(classifyTouch(t({ utm_source: "partner", utm_medium: "referral" }))).toMatchObject({ channel: "referral" });
    expect(classifyTouch(t({ utm_source: "flyer" }))).toEqual({ channel: "tagged", platform: "other", app: null });
  });

  it("reads nothing at all as direct", () => {
    expect(classifyTouch(t({}))).toEqual({ channel: "direct", platform: "direct", app: null });
    expect(classifyTouch(null)).toEqual({ channel: "direct", platform: "direct", app: null });
  });

  it("matches a site by its domain, never by a look-alike", () => {
    expect(siteOfHost("evilfacebook.com")).toBeNull();
    expect(siteOfHost("facebook.com.evil.dz")).toBeNull();
    expect(siteOfHost("notgoogle.com")).toBeNull();
    expect(siteOfHost("M.Facebook.COM")).toMatchObject({ platform: "meta", app: "fb" });
    expect(classifyTouch(t({}, "evilfacebook.com"))).toMatchObject({ channel: "referral" });
  });

  it("gives every touch one known channel, never throwing", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...TOUCH_PARAMS), fc.string()), fc.option(fc.domain()), (params, ref) => {
        expect(ORDER_CHANNELS).toContain(classifyTouch({ params, ref }).channel);
      }),
    );
  });
});

describe("the sites a visit comes from, after Google Analytics and Snowplow", () => {
  const channelOf = (ref: string, params: Record<string, string> = {}) => classifyTouch(t(params, ref));

  it("counts Google's search, on any of its country domains, as Google search", () => {
    for (const host of ["google.com", "www.google.com", "www.google.dz", "google.com.dz", "news.google.com", "lens.google.com", "play.google.com", "images.google.fr", "search.google.com"]) {
      expect(channelOf(host), host).toEqual({ channel: "organic_search", platform: "google", app: null });
    }
  });

  it("never counts Gmail or another Google site as Google search", () => {
    expect(channelOf("mail.google.com")).toEqual({ channel: "email", platform: "other", app: null });
    for (const host of ["groups.google.com", "sites.google.com", "messages.google.com"]) expect(channelOf(host).channel, host).toBe("organic_social");
    for (const host of ["docs.google.com", "accounts.google.com", "maps.google.com", "googleusercontent.com", "notgoogle.com"]) {
      expect(channelOf(host), host).toEqual({ channel: "referral", platform: "referral", app: null });
    }
  });

  it("counts a webmail as email, never as its company's search", () => {
    for (const host of ["mail.google.com", "mail.yahoo.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yandex.ru"]) {
      expect(channelOf(host).channel, host).toBe("email");
    }
  });

  it("counts the search engines shoppers use, Yahoo and Yandex by their search hosts only", () => {
    for (const host of ["bing.com", "cn.bing.com", "search.yahoo.com", "fr.search.yahoo.com", "yahoo.com", "www.yahoo.com", "duckduckgo.com", "yandex.ru", "ya.ru", "search.naver.com", "seznam.cz", "search.brave.com", "petalsearch.com", "www.ecosia.org"]) {
      expect(channelOf(host).channel, host).toBe("organic_search");
    }
    expect(channelOf("answers.yahoo.com").channel).toBe("referral");
  });

  it("reads the app that opened the store on Android by its package", () => {
    expect(channelOf("com.google.android.googlequicksearchbox")).toEqual({ channel: "organic_search", platform: "google", app: null });
    expect(channelOf("com.google.android.gm").channel).toBe("email");
    expect(channelOf("com.facebook.katana")).toEqual({ channel: "organic_social", platform: "meta", app: "fb" });
    expect(channelOf("com.facebook.orca")).toEqual({ channel: "organic_social", platform: "meta", app: "msg" });
    expect(channelOf("com.instagram.android")).toEqual({ channel: "organic_social", platform: "meta", app: "ig" });
    expect(channelOf("com.whatsapp")).toEqual({ channel: "organic_social", platform: "meta", app: "wa" });
    expect(channelOf("com.zhiliaoapp.musically")).toEqual({ channel: "organic_social", platform: "tiktok", app: null });
    expect(channelOf("org.telegram.messenger")).toEqual({ channel: "organic_social", platform: "other", app: null });
    expect(channelOf("com.example.unknownapp")).toEqual({ channel: "referral", platform: "referral", app: null });
  });

  it("keeps an ad from an app an ad, credited to the ad's platform", () => {
    expect(channelOf("com.facebook.katana", { utm_medium: "paid", wc_cn: "Robe" })).toEqual({ channel: "paid_social", platform: "meta", app: "fb" });
    expect(channelOf("com.google.android.googlequicksearchbox", { gclid: "abc" })).toEqual({ channel: "paid_search", platform: "google", app: null });
  });

  it("names the Android apps it knows, and nothing else", () => {
    expect(androidAppName("com.google.android.googlequicksearchbox")).toBe("Google");
    expect(androidAppName("COM.FACEBOOK.KATANA")).toBe("Facebook");
    expect(androidAppName("com.example.unknownapp")).toBeNull();
    expect(androidAppName("google.com")).toBeNull();
    expect(androidAppName(null)).toBeNull();
  });

  it("reads Meta's site_source_name codes as utm_source", () => {
    expect(classifyTouch(t({ utm_source: "msg" }))).toEqual({ channel: "organic_social", platform: "meta", app: "msg" });
    expect(classifyTouch(t({ utm_source: "an", utm_medium: "paid" }))).toEqual({ channel: "paid_social", platform: "meta", app: "an" });
    expect(classifyTouch(t({ utm_source: "th" })).app).toBe("th");
    expect(classifyTouch(t({ utm_source: "wa" })).app).toBe("wa");
  });
});

describe("the signals a URL carries, one table for every platform", () => {
  it("reads every ad's signal as an ad on its platform", () => {
    expect(classifyTouch(t({ gclid: "Cj0" }))).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ gbraid: "0AA" }))).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ wbraid: "Cj1" }))).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ ttclid: "E.C.P" }))).toEqual({ channel: "paid_social", platform: "tiktok", app: null });
    expect(classifyTouch(t({ msclkid: "a1b2" }))).toEqual({ channel: "paid_search", platform: "bing", app: null });
    expect(classifyTouch(t({ ScCid: "f00" }))).toEqual({ channel: "paid_social", platform: "snapchat", app: null });
    expect(classifyTouch(t({ sccid: "f00" }))).toEqual({ channel: "paid_social", platform: "snapchat", app: null });
  });

  it("reads Google's gad_source alone as a Google ad, a search ad when it is 1, as Google and PostHog do", () => {
    expect(isPaidTouch(t({ gad_source: "1" }))).toBe(true);
    expect(classifyTouch(t({ gad_source: "1" }))).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ gad_source: "5" }))).toEqual({ channel: "paid_other", platform: "google", app: null });
    expect(classifyTouch(t({ gad_campaignid: "21000000001" }))).toEqual({ channel: "paid_other", platform: "google", app: null });
    expect(classifyTouch(t({ gad_source: "1", gad_campaignid: "21000000001" }, "www.google.com"))).toEqual({ channel: "paid_search", platform: "google", app: null });
  });

  it("reads Merchant Center's srsltid as Google, never as an ad", () => {
    expect(isPaidTouch(t({ srsltid: "AfmBOo" }))).toBe(false);
    expect(classifyTouch(t({ srsltid: "AfmBOo" }))).toEqual({ channel: "organic_search", platform: "google", app: null });
  });

  it("credits the ad's platform over a fbclid the same link carries", () => {
    expect(classifyTouch(t({ fbclid: "IwAR", ttclid: "E.C" })).platform).toBe("tiktok");
    expect(classifyTouch(t({ fbclid: "IwAR", gclid: "Cj0" })).platform).toBe("google");
    expect(classifyTouch(t({ fbclid: "IwAR", srsltid: "Af" })).platform).toBe("meta");
  });

  it("keeps utm_id and utm_source_platform as touch parameters, as Google Analytics reads them", () => {
    expect(TOUCH_PARAMS).toEqual(expect.arrayContaining(["utm_id", "utm_source_platform", "gad_source", "gad_campaignid", "msclkid", "ScCid", "sccid", "srsltid"]));
    expect(classifyTouch(t({ utm_id: "spring" })).channel).toBe("tagged");
  });

  it("reads a utm_source that is a host as that site", () => {
    expect(classifyTouch(t({ utm_source: "chatgpt.com" }))).toEqual({ channel: "ai_assistant", platform: "other", app: null });
    expect(classifyTouch(t({ utm_source: "l.instagram.com" }))).toEqual({ channel: "organic_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({ utm_source: "newsletter" })).channel).toBe("tagged");
  });

  it("reads Snapchat as its own platform, an ad or not", () => {
    expect(classifyTouch(t({}, "www.snapchat.com"))).toEqual({ channel: "organic_social", platform: "snapchat", app: null });
    expect(classifyTouch(t({ utm_source: "snapchat", utm_medium: "paid" }))).toEqual({ channel: "paid_social", platform: "snapchat", app: null });
    expect(classifyTouch(t({}, "com.snapchat.android")).platform).toBe("snapchat");
  });
});

describe("AI assistants, Google Analytics' AI Assistant channel", () => {
  it("counts a visit from an AI assistant apart from other sites", () => {
    for (const host of ["chatgpt.com", "chat.openai.com", "gemini.google.com", "copilot.microsoft.com", "www.perplexity.ai", "claude.ai", "chat.deepseek.com", "grok.com"]) {
      expect(classifyTouch(t({}, host)), host).toEqual({ channel: "ai_assistant", platform: "other", app: null });
    }
    for (const source of ["chatgpt", "perplexity", "gemini", "copilot", "claude"]) expect(classifyTouch(t({ utm_source: source })).channel, source).toBe("ai_assistant");
    expect(classifyTouch(t({}, "com.openai.chatgpt")).channel).toBe("ai_assistant");
    expect(androidAppName("com.openai.chatgpt")).toBe("ChatGPT");
  });

  it("keeps Google's own search Google search, and an assistant's ad an ad", () => {
    expect(classifyTouch(t({}, "www.google.com")).channel).toBe("organic_search");
    expect(classifyTouch(t({ utm_source: "chatgpt", utm_medium: "cpc" })).channel).toBe("paid_other");
  });
});

describe("a touch read without its ad", () => {
  it("reads an ad clicked too long ago as what it is without the ad, never as a paid source", () => {
    expect(classifyTouch(t(META_TEMPLATE), { ad: false })).toEqual({ channel: "organic_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({ gclid: "Cj0" }), { ad: false })).toEqual({ channel: "organic_search", platform: "google", app: null });
    expect(classifyTouch(t({ ttclid: "E.C" }), { ad: false })).toEqual({ channel: "organic_social", platform: "tiktok", app: null });
    expect(classifyTouch(t({ utm_source: "partner", utm_medium: "cpc" }), { ad: false }).channel).toBe("tagged");
  });

  it("reads a touch that was no ad the same either way", () => {
    for (const touch of [t({}, "www.google.com"), t({ fbclid: "IwAR" }), t({}, "chatgpt.com"), t({ utm_medium: "email" }), t({})]) {
      expect(classifyTouch(touch, { ad: false })).toEqual(classifyTouch(touch));
    }
  });
});
