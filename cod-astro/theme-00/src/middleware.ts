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
//
// The preview route (`/wocart-preview`, an editor's frame) is the exception:
// its store context is the draft's, and it never runs a form action. The
// revalidation route (`/wocart-revalidate`) needs no store at all.
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { runFormAction } from "@wocart/storefront/astro";
import { THEME_PREVIEW_PATH } from "@wocart/theme";
import { resolvePreviewStore, resolveStoreRequest } from "@/theme/runtime/store";
import { REVALIDATE_PATH, readThemePreview } from "@/theme/sdk";

export const onRequest = defineMiddleware(async (context, next) => {
  // A prerendered page is built once, for every store: it has no request
  // store to resolve (the theme's manifest is the one such page).
  if (context.isPrerendered) return next();
  if (context.url.pathname === REVALIDATE_PATH) return next();
  if (context.url.pathname === THEME_PREVIEW_PATH) {
    const preview = await readThemePreview(context.request);
    if (!preview.ok) return new Response(null, { status: preview.status, headers: { "Cache-Control": "no-store" } });
    context.locals.store = await resolvePreviewStore(preview.draft);
    context.locals.preview = { claims: preview.claims, draft: preview.draft, token: preview.token };
    return next();
  }
  // Store context first: the form action below may read `context.locals`, and
  // the page that renders afterwards needs it too. The SDK decides the
  // language and the redirects (see theme/runtime/store.ts).
  const request = await resolveStoreRequest(context.url, context.request.headers.get("Referer"));
  if (request.kind === "redirect") return context.redirect(request.location, request.status);
  context.locals.store = request.store;

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

  return request.rewrite === null ? next() : next(request.rewrite);
});