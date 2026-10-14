// Astro requires middleware in src/middleware.ts. This file is framework
// wiring only. Two jobs, in order:
//
// 1. Store context (Theme Zero S2): `locals.store` is the ONE acquisition
//    point for { config, content, locale, client, href, … } — pages, layouts
//    and components take it from `Astro.locals`, never by building their own.
//    The request's language comes from its path (`/fr/…`), or for a server
//    island or an `/api/*` endpoint from the page that asked for it. Each
//    request reads the config with its own client (see theme/sdk.ts).
// 2. The SDK's form action: it runs an action posted from a form and stores the
//    result for the page this POST renders — the thank-you redirect on success,
//    the form with its error in place on a refusal.
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { runFormAction } from "@wocart/storefront/astro";
import { languageSource, resolveStoreRequest } from "@/theme/runtime/store";

export const onRequest = defineMiddleware(async (context, next) => {
  // Store context first: the form action below may read `context.locals`, and
  // the page that renders afterwards needs it too.
  // The language comes from the path (`/fr/…`, ADR 0005): the primary's own
  // prefix redirects to its one address, and a prefixed page renders the
  // unprefixed route with the store context in that language.
  // A server island or an `/api/*` endpoint takes the language of the page
  // that requested it, and is never redirected or rewritten: its own URL is
  // the endpoint.
  let route = context.url.pathname;
  const source = languageSource(context.url, context.request.headers.get("Referer"));
  let request = await resolveStoreRequest(source.path);
  if (request.kind === "redirect") {
    if (!source.embedded) return context.redirect(`${request.location}${context.url.search}`, request.status);
    // The asking page's address redirects; the request is served like its target.
    request = await resolveStoreRequest(request.location);
  }
  if (request.kind === "page") {
    context.locals.store = request.store;
    if (!source.embedded) route = request.store.pathname;
  }

  const { action, setActionResult, serializeActionResult } =
    getActionContext(context);

  await runFormAction({
    action: action && {
      calledFrom: action.calledFrom,
      name: action.name,
      handler: action.handler,
    },
    setActionResult,
    serializeActionResult,
  });

  return route === context.url.pathname ? next() : next(new URL(`${route}${context.url.search}`, context.url));
});