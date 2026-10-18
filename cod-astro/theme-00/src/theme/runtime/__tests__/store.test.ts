// @vitest-environment node
/**
 * S5 — `resolveStoreRequest()` reads the store config through the theme adapter.
 *
 * Pages have always called `getStoreContext()` for config; S5 changes the
 * source of truth from the legacy `@/core/api/client` fetch (deleted since) to
 * the SDK client created in `src/theme/sdk.ts`, without changing the function's
 * contract: values from the server, `resolveContent` applied, `DEFAULT_CONFIG`
 * on any failure.
 *
 * The caching test is the one that pins the delegation: the SDK client caches
 * a successful config read for the lifetime of the client, so two renders in
 * one isolate must produce ONE `/store/config` request. The legacy fetch had
 * no cache and made two.
 *
 * The config fixture is a live capture (wocart-sdk/storefront/fixtures/cod-server/
 * store-config.json) in its real `{ success, data }` envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIVE_CONFIG = {
  id: "store_01",
  name: "متجر الجزائر",
  domain: "algiers-gadgets.codflow.store",
  logoUrl: "https://media.codflow.store/stores/store_01/logo.png",
  themeId: "theme-00",
  primaryColor: "#7c3aed",
  accentColor: "#f59e0b",
  bgColor: "#f8f8f8",
  fontFamily: "Cairo, sans-serif",
  fontUrl: null,
  lang: "ar",
  locale: "ar",
  currency: "DZD",
  currencySymbol: "دج",
  locales: [
    { code: "ar", nativeName: "العربية", direction: "rtl" },
    { code: "fr", nativeName: "Français", direction: "ltr" },
  ],
  contentOverrides: { ar: { heroTitle: "عرض اليوم" }, fr: { heroTitle: "L'offre du jour" } },
  metaTitle: "متجر الجزائر",
  metaDescription: "الدفع عند الاستلام في كل ولايات الوطن",
  ogImage: null,
  announcementBar: null,
  reviewsEnabled: true,
  cartEnabled: false,
  freeShippingThreshold: 8000,
  cartShippingMode: "highest",
  status: "active",
  createdAt: "2026-08-01T09:15:00.000Z",
  updatedAt: "2026-09-20T11:02:31.000Z",
  checkoutForm: {
    address: "optional",
    notes: "optional",
    email: "optional",
    deliveryOptions: { home: true, stopDesk: true },
    customFields: [
      {
        id: "cf_delivery_time",
        label: "وقت التسليم المفضل",
        type: "select",
        required: false,
        options: ["صباحاً", "مساءً"],
      },
    ],
  },
  whatsapp: {
    href: "https://wa.me/213551234567",
    agentName: "أمين",
    caption: "نرد خلال دقائق",
    avatarUrl: null,
    welcomeMessage: "أهلاً! كيف نقدر نعاونك؟",
    launcherLabel: null,
    ctaLabel: "اسأل على واتساب",
    prefillGeneral: "سلام، عندي سؤال على {url}",
    prefillProduct: "سلام، بغيت نسقسي على {product}",
    thankYouButtonLabel: "شكراً لك",
    prefillThankYou: "سلام، وصلني الطلب {order}",
    accent: "whatsapp",
    position: "right",
    attention: true,
    surfaces: {
      home: true,
      catalog: true,
      product: true,
      pages: false,
      thankYou: false,
      checkout: false,
      landing: false,
    },
  },
  pixelId: "1234567890123456",
  conversionEvent: "Purchase",
  pages: [
    { id: "page_refund", kind: "refund", slug: "refund-policy", title: "سياسة الإرجاع", position: 1 },
    { id: "page_terms", kind: "terms", slug: "terms", title: "شروط الاستخدام", position: 2 },
  ],
  legalContact: {
    contactEmail: "support@algiers-gadgets.dz",
    contactPhone: "0551234567",
    deliveryMinDays: 2,
    deliveryMaxDays: 5,
  },
  otpEnabled: true,
  turnstileEnabled: false,
  turnstileSiteKey: null,
};

// Same environment-boundary mock as src/theme/sdk.test.ts — see the comment
// there for why `astro:env/server` is mocked rather than process.env stubbed.
const env = vi.hoisted(() => ({
  COD_SERVER_URL: undefined as string | undefined,
  STORE_API_KEY: undefined as string | undefined,
  MEDIA_DOMAIN: undefined as string | undefined,
}));

vi.mock("astro:env/server", () => ({
  get COD_SERVER_URL() {
    return env.COD_SERVER_URL;
  },
  get STORE_API_KEY() {
    return env.STORE_API_KEY;
  },
  get MEDIA_DOMAIN() {
    return env.MEDIA_DOMAIN;
  },
}));

/**
 * A cod-server that answers `/store/config` like the real one: in the
 * requested language when the store publishes it (`locale` reports which),
 * with `perLocale` overriding fields per served language.
 */
function stubConfigServer(
  overrides: Record<string, unknown> = {},
  perLocale: Record<string, Record<string, unknown>> = {},
): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const base = { ...LIVE_CONFIG, ...overrides } as typeof LIVE_CONFIG;
    const requested = new URL(String(input)).searchParams.get("locale");
    const published = base.locales.map((language) => language.code);
    const locale = requested !== null && published.includes(requested) ? requested : base.lang;
    return new Response(
      JSON.stringify({ success: true, data: { ...base, locale, ...(perLocale[locale] ?? {}) } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return calls;
}

/** The store context of a page request — failing the test if it redirects. */
async function storeFor(path: string) {
  const { resolveStoreRequest } = await import("@/theme/runtime/store");
  const request = await resolveStoreRequest(path);
  if (request.kind !== "page") throw new Error(`${path} redirected to ${request.location}`);
  return request.store;
}

describe("resolveStoreRequest() — through the S5 adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    env.COD_SERVER_URL = "https://api.example.test";
    env.STORE_API_KEY = "test-key-abc";
  });

  afterEach(() => {
    env.COD_SERVER_URL = undefined;
    env.STORE_API_KEY = undefined;
    env.MEDIA_DOMAIN = undefined;
    vi.unstubAllGlobals();
  });

  it("serves the server config with content resolved (isRTL for Arabic)", async () => {
    const calls = stubConfigServer();

    const ctx = await storeFor("/");

    // Named by its key, the theme gets the store's edits to its own text.
    expect(calls).toEqual(["https://api.example.test/store/config?theme=theme-00"]);
    expect(ctx.config.name).toBe("متجر الجزائر");
    expect(ctx.config.currencySymbol).toBe("دج");
    expect(ctx.isRTL).toBe(true);
    expect(ctx.locale).toBe("ar");
    expect(ctx.content.heroTitle).toBe("عرض اليوم");
    expect(ctx.fallbackLocales).toEqual([]);
    expect(ctx.href("/products")).toBe("/products");
  });

  it("resolves the store language's own overrides, never another language's", async () => {
    stubConfigServer({ lang: "fr", locales: [...LIVE_CONFIG.locales].reverse() });

    const ctx = await storeFor("/");

    expect(ctx.locale).toBe("fr");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.content.heroTitle).toBe("L'offre du jour");
    expect(ctx.content.heroTitle).not.toBe("عرض اليوم");
  });

  it("serves /fr/… in French: its config, pack, direction, links and fallback", async () => {
    const calls = stubConfigServer({}, { fr: { metaTitle: "Boutique d'Alger" } });

    const ctx = await storeFor("/fr/products/phone");

    expect(ctx.locale).toBe("fr");
    expect(ctx.pathname).toBe("/products/phone");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.config.metaTitle).toBe("Boutique d'Alger");
    expect(ctx.content.heroTitle).toBe("L'offre du jour");
    expect(ctx.fallbackLocales).toEqual(["ar"]);
    expect(ctx.href("/checkout")).toBe("/fr/checkout");
    expect(ctx.href("/")).toBe("/fr");
    expect(calls).toContain("https://api.example.test/store/config?theme=theme-00&locale=fr");
  });

  it("gives the primary language one address: /ar/… redirects permanently", async () => {
    stubConfigServer();
    const { resolveStoreRequest } = await import("@/theme/runtime/store");
    expect(await resolveStoreRequest("/ar/products/phone")).toEqual({
      kind: "redirect",
      location: "/products/phone",
      status: 301,
    });
  });

  it("treats an unpublished language's prefix as an ordinary path", async () => {
    stubConfigServer();
    const ctx = await storeFor("/en/products");
    expect(ctx.locale).toBe("ar");
    expect(ctx.pathname).toBe("/en/products");
  });

  it("sends a shopper to the primary URL when the server no longer serves the language", async () => {
    stubConfigServer({}, { fr: { locale: "ar" } });
    const { resolveStoreRequest } = await import("@/theme/runtime/store");
    expect(await resolveStoreRequest("/fr/products/phone")).toEqual({
      kind: "redirect",
      location: "/products/phone",
      status: 302,
    });
  });

  it("serves a store language it has no pack for: the server's direction, the default pack's text", async () => {
    stubConfigServer({
      lang: "zgh",
      locales: [{ code: "zgh", nativeName: "ⵜⴰⵎⴰⵣⵉⵖⵜ", direction: "ltr" }],
      contentOverrides: { zgh: { heroTitle: "ⴰⵣⵓⵍ" } },
    });

    const { resolveContent, DEFAULT_LANGUAGE } = await import("@/theme/content");
    const ctx = await storeFor("/");

    expect(ctx.locale).toBe("zgh");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.content.heroTitle).toBe("ⴰⵣⵓⵍ");
    expect(ctx.content.orderCta).toBe(resolveContent(DEFAULT_LANGUAGE).orderCta);
  });

  it("reads config once per request, and never reuses another request's read", async () => {
    const calls = stubConfigServer();
    const configReads = () => calls.filter((url) => new URL(url).pathname === "/store/config").length;

    await storeFor("/");
    expect(configReads()).toBe(1);

    // A second request reads its own: a read shared across requests is what
    // hung pages once the request that started it was cancelled.
    await storeFor("/products");
    expect(configReads()).toBe(2);
  });

  it("falls back to DEFAULT_CONFIG when the config read fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const { DEFAULT_CONFIG } = await import("@/theme/runtime/store");
    const ctx = await storeFor("/");

    expect(ctx.config.name).toBe(DEFAULT_CONFIG.name);
    expect(ctx.isRTL).toBe(true);
  });
});

describe("resolvePreviewStore() — the store as an editor's draft would leave it", () => {
  beforeEach(() => {
    vi.resetModules();
    env.COD_SERVER_URL = "https://api.example.test";
    env.STORE_API_KEY = "test-key-abc";
  });

  afterEach(() => {
    env.COD_SERVER_URL = undefined;
    env.STORE_API_KEY = undefined;
    vi.unstubAllGlobals();
  });

  const preview = async (draft: import("@/theme/sdk").PreviewDraft) => (await import("@/theme/runtime/store")).resolvePreviewStore(draft);

  it("renders the draft's text edits and settings over the saved ones, without the pixel", async () => {
    stubConfigServer({ themeSettings: { primaryColor: "#7c3aed" } });
    const ctx = await preview({ surface: "home", settings: { primaryColor: "#112233" }, content: { ar: { heroTitle: "تخفيضات الصيف" } } });

    expect(ctx.locale).toBe("ar");
    expect(ctx.isRTL).toBe(true);
    expect(ctx.content.heroTitle).toBe("تخفيضات الصيف");
    expect(ctx.config.themeSettings).toEqual({ primaryColor: "#112233" });
    expect(ctx.config.pixelId).toBeNull();
    expect(ctx.pathname).toBe("/");
    expect(ctx.href("/products")).toBe("/products");
  });

  it("previews a published language with its own config, client and links", async () => {
    const calls = stubConfigServer({}, { fr: { metaTitle: "Boutique d'Alger" } });
    const ctx = await preview({ surface: "home", locale: "fr", content: { fr: { heroTitle: "Soldes" }, ar: { heroTitle: "تخفيضات" } } });

    expect(ctx.locale).toBe("fr");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.config.metaTitle).toBe("Boutique d'Alger");
    expect(ctx.content.heroTitle).toBe("Soldes");
    expect(ctx.fallbackLocales).toEqual(["ar"]);
    expect(ctx.href("/products")).toBe("/fr/products");
    expect(calls).toContain("https://api.example.test/store/config?theme=theme-00&locale=fr");
  });

  it("falls back to the primary for a language the store does not serve", async () => {
    const calls = stubConfigServer({}, { fr: { locale: "ar" } });
    for (const locale of ["en", "fr", "ar"]) {
      const ctx = await preview({ surface: "home", locale });
      expect(ctx.locale).toBe("ar");
      expect(ctx.isRTL).toBe(true);
      expect(ctx.fallbackLocales).toEqual([]);
    }
    // A language the store does not publish is never asked for.
    expect(calls.filter((url) => url.includes("locale=en"))).toEqual([]);
  });

  it("keeps the page a template draft is previewed for", async () => {
    stubConfigServer();
    expect((await preview({ surface: "product", path: "/products/phone" })).pathname).toBe("/products/phone");
  });
});

describe("languageSource — where a request's language comes from", () => {
  const page = (path: string) => new URL(`https://shop.dz${path}`);

  it("a page takes it from its own path", async () => {
    const { languageSource } = await import("@/theme/runtime/store");
    expect(languageSource(page("/fr/products/x"), "https://shop.dz/ar/")).toEqual({ path: "/fr/products/x", embedded: false });
  });

  it("a server island takes it from the page that asked for it", async () => {
    const { languageSource } = await import("@/theme/runtime/store");
    expect(languageSource(page("/_server-islands/RelatedProducts?e=1"), "https://shop.dz/fr/products/x")).toEqual({
      path: "/fr/products/x",
      embedded: true,
    });
  });

  it("an /api endpoint takes it from the page that called it", async () => {
    const { languageSource } = await import("@/theme/runtime/store");
    expect(languageSource(page("/api/cart/validate"), "https://shop.dz/fr/checkout")).toEqual({ path: "/fr/checkout", embedded: true });
    expect(languageSource(page("/apiary"), null)).toEqual({ path: "/apiary", embedded: false });
  });

  it("an island without a same-origin referer renders in the primary", async () => {
    const { languageSource } = await import("@/theme/runtime/store");
    for (const referer of [null, "https://evil.example/fr/x", "not a url"]) {
      expect(languageSource(page("/_server-islands/ReviewsIsland"), referer)).toEqual({ path: "/", embedded: true });
    }
  });
});
