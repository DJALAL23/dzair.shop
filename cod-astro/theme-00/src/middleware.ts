// Astro requires middleware in src/middleware.ts. This file is framework
// wiring only. Two jobs, in order:
//
// 1. Store context (Theme Zero S2): `locals.store` is the ONE acquisition
//    point for { config, content, locale, client, href, … } — pages, layouts
//    and components take it from `Astro.locals`, never by building their own.
//    The request's language comes from its path (`/fr/…`), or for a server
//    island or an `/api/*` endpoint from the page that asked for it. The
//    config read behind it is cached per client scope, so this costs one
//    fetch per isolate and language.
// 2. The SDK's PRG decision: on an action error the shopper is sent back to
//    the form with a 303; on success call next() so the result cookie
//    survives — see resolveActionRedirectDecision.
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { resolveActionRedirectDecision } from "@codflow/storefront/astro";
import { languageSource, resolveStoreRequest } from "@/theme/runtime/store";

export const onRequest = defineMiddleware(async (context, next) => {
  // Store context first: the action handler runs inside the PRG decision below
  // and may read `context.locals`, and the page that renders afterwards needs
  // it too. The config read is cached per client scope.
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

  const decision = await resolveActionRedirectDecision({
    action: action && {
      calledFrom: action.calledFrom,
      name: action.name,
      handler: action.handler,
    },
    setActionResult,
    serializeActionResult,
    referer: context.request.headers.get("Referer"),
    pathname: context.url.pathname,
  });

  if (decision.kind === "redirect") {
    return context.redirect(decision.location, decision.status);
  }

  return route === context.url.pathname ? next() : next(new URL(`${route}${context.url.search}`, context.url));
});