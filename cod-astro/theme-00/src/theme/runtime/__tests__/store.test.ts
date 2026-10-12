// @vitest-environment node
/**
 * S5 — `getStoreContext()` reads the store config through the theme adapter.
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
 * The config fixture is a live capture (cod-sdk/storefront/fixtures/cod-server/
 * store-config.json) in its real `{ success, data }` envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIVE_CONFIG = {
  id: "store_01",
  name: "متجر الجزائر",
  domain: "algiers-gadgets.codflow.store",
  logoUrl: "https://media.codflow.store/stores/store_01/logo.png",
  themeId: "theme01",
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
  announcementBar: "توصيل مجاني للطلبات فوق 8000 دج",
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

function stubConfigServer(overrides: Record<string, unknown> = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({ success: true, data: { ...LIVE_CONFIG, ...overrides } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return calls;
}

describe("getStoreContext() — through the S5 adapter", () => {
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

    const { getStoreContext } = await import("@/theme/runtime/store");
    const ctx = await getStoreContext();

    // Named by its key, the theme gets the store's edits to its own text.
    expect(calls).toEqual(["https://api.example.test/store/config?theme=theme-00"]);
    expect(ctx.config.name).toBe("متجر الجزائر");
    expect(ctx.config.currencySymbol).toBe("دج");
    expect(ctx.config.announcementBar).toBe("توصيل مجاني للطلبات فوق 8000 دج");
    expect(ctx.isRTL).toBe(true);
    expect(ctx.locale).toBe("ar");
    expect(ctx.content.heroTitle).toBe("عرض اليوم");
  });

  it("resolves the store language's own overrides, never another language's", async () => {
    stubConfigServer({ lang: "fr", locales: [...LIVE_CONFIG.locales].reverse() });

    const { getStoreContext } = await import("@/theme/runtime/store");
    const ctx = await getStoreContext();

    expect(ctx.locale).toBe("fr");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.content.heroTitle).toBe("L'offre du jour");
    expect(ctx.content.heroTitle).not.toBe("عرض اليوم");
  });

  it("serves a store language it has no pack for: the server's direction, the default pack's text", async () => {
    stubConfigServer({
      lang: "zgh",
      locales: [{ code: "zgh", nativeName: "ⵜⴰⵎⴰⵣⵉⵖⵜ", direction: "ltr" }],
      contentOverrides: { zgh: { heroTitle: "ⴰⵣⵓⵍ" } },
    });

    const { getStoreContext } = await import("@/theme/runtime/store");
    const { resolveContent, DEFAULT_LANGUAGE } = await import("@/theme/content");
    const ctx = await getStoreContext();

    expect(ctx.locale).toBe("zgh");
    expect(ctx.isRTL).toBe(false);
    expect(ctx.content.heroTitle).toBe("ⴰⵣⵓⵍ");
    expect(ctx.content.orderCta).toBe(resolveContent(DEFAULT_LANGUAGE).orderCta);
  });

  it("fetches config once per client — the second render reuses the SDK cache", async () => {
    const calls = stubConfigServer();

    const { getStoreContext } = await import("@/theme/runtime/store");
    await getStoreContext();
    await getStoreContext();

    expect(calls.filter((url) => new URL(url).pathname === "/store/config")).toHaveLength(1);
  });

  it("falls back to DEFAULT_CONFIG when the config read fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const { getStoreContext, DEFAULT_CONFIG } = await import("@/theme/runtime/store");
    const ctx = await getStoreContext();

    expect(ctx.config.name).toBe(DEFAULT_CONFIG.name);
    expect(ctx.isRTL).toBe(true);
  });
});
