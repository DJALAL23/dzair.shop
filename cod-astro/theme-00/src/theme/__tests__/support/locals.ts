/**
 * `Astro.locals` for a component rendered in a test container — the same
 * store context middleware builds for a real request, so components read
 * links, language and the SDK client exactly as they do in production.
 */
import { localizeHref, type LocaleRouting } from "@wocart/storefront";
import type { StoreClient } from "@/theme/sdk";
import { en } from "@/theme/content/en";
import { DEFAULT_CONFIG, type StoreContext } from "@/theme/runtime/store";

export function testStore(overrides: Partial<StoreContext> & { routing?: LocaleRouting } = {}): StoreContext {
  const routing = overrides.routing ?? { primary: "en", published: ["en"] };
  const locale = overrides.locale ?? routing.primary;
  return {
    config: DEFAULT_CONFIG,
    content: en,
    locale,
    fallbackLocales: locale === routing.primary ? [] : [routing.primary],
    isRTL: false,
    client: undefined as unknown as StoreClient,
    routing,
    pathname: "/",
    href: (path) => localizeHref(path, locale, routing),
    ...overrides,
  };
}

export function testLocals(overrides: Parameters<typeof testStore>[0] = {}): App.Locals {
  // The cast satisfies the full `App.Locals` shape: the Cloudflare adapter
  // adds a `cfContext` no component reads.
  return { store: testStore(overrides) } as unknown as App.Locals;
}
