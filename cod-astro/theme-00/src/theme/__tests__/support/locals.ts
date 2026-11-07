/**
 * `Astro.locals` for a component rendered in a test container — the same
 * store context middleware builds for a real request, so components read
 * links, language and the SDK client exactly as they do in production.
 */
import { localizeHref, type LocaleRouting, type StoreConfig } from "@wocart/storefront";
import type { StoreClient } from "@/theme/sdk";
import { en } from "@/theme/content/en";
import type { StoreContext } from "@/theme/runtime/store";

/** A store as its server answers: one language, nothing switched on beyond reviews, its media served from its own domain. */
export const TEST_CONFIG: StoreConfig = {
  id: "store_test",
  name: "متجري",
  domain: null,
  logo: null,
  lang: "ar",
  locale: "ar",
  locales: [{ code: "ar", nativeName: "العربية", direction: "rtl" }],
  currency: "DZD",
  currencySymbol: "دج",
  metaTitle: null,
  metaDescription: null,
  ogImage: null,
  media: { kind: "cloudflare", origin: "https://media.boutique.test" },
  reviewsEnabled: true,
  cartEnabled: false,
  freeShippingThreshold: null,
  contentOverrides: {},
  themeSettings: {},
  checkoutForm: { address: "optional", notes: "optional", email: "hidden", deliveryOptions: { home: true, stopDesk: true }, customFields: [] },
  whatsapp: null,
  pixelId: null,
  pages: [],
  contact: { phone: null, email: null, address: null },
  otpEnabled: false,
  turnstileEnabled: false,
  turnstileSiteKey: null,
};

/** A store with no menus and no saved pages: every area renders the theme's default. */
const EMPTY_CLIENT = { menus: { get: async () => null }, pageData: { get: async () => null } };

export function testStore(overrides: Partial<StoreContext> & { routing?: LocaleRouting } = {}): StoreContext {
  const routing = overrides.routing ?? { primary: "en", published: ["en"] };
  const locale = overrides.locale ?? routing.primary;
  return {
    config: TEST_CONFIG,
    content: en,
    locale,
    fallbackLocales: locale === routing.primary ? [] : [routing.primary],
    isRTL: false,
    routing,
    pathname: "/",
    href: (path) => localizeHref(path, locale, routing),
    ...overrides,
    // A test's client stands in for the namespaces it names; the rest read as empty, and its config is the store's.
    client: { ...EMPTY_CLIENT, config: { get: async () => overrides.config ?? TEST_CONFIG }, ...(overrides.client as object | undefined) } as unknown as StoreClient,
  };
}

export function testLocals(overrides: Parameters<typeof testStore>[0] = {}): App.Locals {
  // The cast satisfies the full `App.Locals` shape: the Cloudflare adapter
  // adds a `cfContext` no component reads.
  return { store: testStore(overrides) } as unknown as App.Locals;
}
