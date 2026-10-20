/**
 * The context every section of a page renders with: the store, its words in
 * the request's language, and the route's parameters (`{ handle }` on a product
 * page), from which a template's sections read their resource.
 */
import type { ThemeRenderContext } from "@wocart/theme";
import type { StoreContext } from "./store";

export function renderContext(store: StoreContext, params: Readonly<Record<string, string | undefined>> = {}): ThemeRenderContext {
  return {
    store: store.config,
    content: store.content,
    locale: store.locale,
    fallbackLocales: store.fallbackLocales,
    isRTL: store.isRTL,
    url: store.pathname,
    params,
  };
}
